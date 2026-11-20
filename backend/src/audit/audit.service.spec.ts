import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  const create = vi.fn();
  const prisma = { auditLog: { create } } as unknown as PrismaService;
  const service = new AuditService(prisma);

  beforeEach(() => create.mockReset());

  it('remove campos fora da lista permitida (como o hash da senha)', async () => {
    await service.record({
      action: 'PASSWORD_CHANGED',
      entity: 'User',
      entityId: 'u1',
      after: {
        id: 'u1',
        email: 'ana@loja.com',
        passwordHash: '$argon2id$segredo',
        tokenVersion: 3,
      },
    });

    const { data } = create.mock.calls[0][0];
    expect(data.after).toEqual({ id: 'u1', email: 'ana@loja.com' });
    expect(JSON.stringify(data)).not.toContain('argon2id');
  });

  it('grava no client da transação quando ele é informado', async () => {
    const txCreate = vi.fn();
    const tx = { auditLog: { create: txCreate } };

    await service.record({ action: 'LOGOUT', userId: 'u1' }, tx as never);

    expect(txCreate).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  describe('list', () => {
    const count = vi.fn();
    const findMany = vi.fn();
    const listService = new AuditService({
      auditLog: { count, findMany },
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    } as unknown as PrismaService);

    const base = {
      page: 1,
      pageSize: 20,
      sort: 'createdAt' as const,
      order: 'desc' as const,
    };

    beforeEach(() => {
      count.mockReset().mockResolvedValue(0);
      findMany.mockReset().mockResolvedValue([]);
    });

    it('monta o filtro com período (from inclusivo, to exclusivo)', async () => {
      await listService.list({
        ...base,
        userId: 'u1',
        action: 'ACCESS_DENIED',
        from: '2026-11-01T00:00:00Z',
        to: '2026-11-02T00:00:00Z',
      });

      const { where, orderBy } = findMany.mock.calls[0][0];
      expect(where).toEqual({
        userId: 'u1',
        action: 'ACCESS_DENIED',
        createdAt: {
          gte: new Date('2026-11-01T00:00:00Z'),
          lt: new Date('2026-11-02T00:00:00Z'),
        },
      });
      // O id desempata registros com o mesmo createdAt.
      expect(orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    });

    it('sem filtros, não restringe nada', async () => {
      await listService.list(base);
      expect(findMany.mock.calls[0][0].where).toEqual({});
    });

    it.each([
      ['from igual a to', '2026-11-02T00:00:00Z'],
      ['from depois de to', '2026-11-01T00:00:00Z'],
    ])('recusa com 400 quando %s', async (_, to) => {
      await expect(
        listService.list({ ...base, from: '2026-11-02T00:00:00Z', to }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('devolve o usuário junto e o meta da paginação', async () => {
      const createdAt = new Date('2026-11-20T12:00:00Z');
      count.mockResolvedValue(21);
      findMany.mockResolvedValue([
        {
          id: 'a1',
          action: 'LOGIN_FAILED',
          userId: null,
          user: null,
          entity: null,
          entityId: null,
          before: null,
          after: null,
          metadata: { email: 'x@loja.com' },
          ip: '10.0.0.1',
          createdAt,
        },
      ]);

      const page = await listService.list(base);

      expect(page.meta).toEqual({
        page: 1,
        pageSize: 20,
        total: 21,
        totalPages: 2,
      });
      expect(page.data[0]).toEqual({
        id: 'a1',
        action: 'LOGIN_FAILED',
        user: null,
        entity: null,
        entityId: null,
        before: null,
        after: null,
        metadata: { email: 'x@loja.com' },
        ip: '10.0.0.1',
        createdAt,
      });
    });
  });

  it('aceita registro sem usuário (login com e-mail inexistente)', async () => {
    await service.record({
      action: 'LOGIN_FAILED',
      metadata: { email: 'ninguem@loja.com' },
      ip: '10.0.0.1',
    });

    expect(create.mock.calls[0][0].data).toMatchObject({
      action: 'LOGIN_FAILED',
      userId: null,
      ip: '10.0.0.1',
    });
  });
});
