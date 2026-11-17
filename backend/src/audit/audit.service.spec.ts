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
