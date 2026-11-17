import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import type { PasswordService } from '../auth/password.service.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

const admin: AuthenticatedUser = {
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@loja.com',
  role: 'ADMIN',
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u2',
    name: 'Bia',
    email: 'bia@loja.com',
    passwordHash: '$argon2id$hash',
    role: 'VENDEDOR',
    active: true,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    refreshToken: { updateMany: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const passwords = { hash: vi.fn().mockResolvedValue('$argon2id$novo') };
  const audit = { record: vi.fn() };
  const service = new UsersService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    audit as unknown as AuditService,
  );
  return { service, tx, audit };
}

describe('UsersService', () => {
  describe('update', () => {
    it('recusa corpo vazio com 400', async () => {
      const { service } = setup();
      await expect(service.update(admin, 'u2', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('usuário inexistente: 404', async () => {
      const { service, tx } = setup();
      tx.user.findUnique.mockResolvedValue(null);

      await expect(
        service.update(admin, 'u2', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ADMIN não pode mudar o próprio papel nem se desativar (403)', async () => {
      const { service, tx } = setup();
      tx.user.findUnique.mockResolvedValue(
        makeUser({ id: admin.id, role: 'ADMIN' }),
      );

      await expect(
        service.update(admin, admin.id, { role: 'GERENTE' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.update(admin, admin.id, { active: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ADMIN pode editar o próprio nome', async () => {
      const { service, tx } = setup();
      const self = makeUser({ id: admin.id, role: 'ADMIN' });
      tx.user.findUnique.mockResolvedValue(self);
      tx.user.update.mockResolvedValue({ ...self, name: 'Novo' });

      await expect(
        service.update(admin, admin.id, { name: 'Novo' }),
      ).resolves.toMatchObject({ name: 'Novo' });
    });

    it('trava os ADMINs ANTES de ler o usuário (senão decidiria com dado velho)', async () => {
      const { service, tx } = setup();
      const target = makeUser({ role: 'ADMIN' });
      tx.$queryRaw.mockResolvedValue([{ id: admin.id }, { id: 'u2' }]);
      tx.user.findUnique.mockResolvedValue(target);
      tx.user.update.mockResolvedValue({ ...target, role: 'GERENTE' });

      await service.update(admin, 'u2', { role: 'GERENTE' });

      const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
      const readOrder = tx.user.findUnique.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(readOrder);
      expect(String(tx.$queryRaw.mock.calls[0][0])).toContain('FOR UPDATE');
    });

    it('não trava nada quando só muda nome ou e-mail', async () => {
      const { service, tx } = setup();
      tx.user.findUnique.mockResolvedValue(makeUser());
      tx.user.update.mockResolvedValue(makeUser({ name: 'Outro' }));

      await service.update(admin, 'u2', { name: 'Outro' });

      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('recusa rebaixar o último ADMIN ativo (409)', async () => {
      const { service, tx } = setup();
      // Situação que só acontece em concorrência: o lock devolveu apenas o alvo.
      tx.$queryRaw.mockResolvedValue([{ id: 'u2' }]);
      tx.user.findUnique.mockResolvedValue(makeUser({ role: 'ADMIN' }));

      await expect(
        service.update(admin, 'u2', { role: 'VENDEDOR' }),
      ).rejects.toThrow(
        new ConflictException('É preciso manter pelo menos um ADMIN ativo'),
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('desativar incrementa tokenVersion, revoga as sessões e audita antes/depois', async () => {
      const { service, tx, audit } = setup();
      const target = makeUser();
      tx.user.findUnique.mockResolvedValue(target);
      tx.user.update.mockResolvedValue({ ...target, active: false });

      await service.update(admin, 'u2', { active: false }, '10.0.0.1');

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'u2' },
        data: expect.objectContaining({
          active: false,
          tokenVersion: { increment: 1 },
        }),
      });
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u2', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_UPDATED',
          userId: admin.id,
          entityId: 'u2',
          before: expect.objectContaining({ active: true }),
          after: expect.objectContaining({ active: false }),
        }),
        tx,
      );
    });

    it('e-mail duplicado (P2002) vira 409', async () => {
      const { service, tx } = setup();
      tx.user.findUnique.mockResolvedValue(makeUser());
      tx.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '7.10.1',
        }),
      );

      await expect(
        service.update(admin, 'u2', { email: 'outro@loja.com' }),
      ).rejects.toThrow(new ConflictException('E-mail já cadastrado'));
    });
  });

  describe('create', () => {
    it('grava o hash (nunca a senha) e audita sem o hash', async () => {
      const { service, tx, audit } = setup();
      tx.user.create.mockImplementation(({ data }) =>
        Promise.resolve(makeUser({ ...data, id: 'novo' })),
      );

      const created = await service.create(admin, {
        name: 'Caio',
        email: 'caio@loja.com',
        password: 'senha-forte-1',
        role: 'GERENTE',
      });

      expect(tx.user.create.mock.calls[0][0].data).toMatchObject({
        passwordHash: '$argon2id$novo',
      });
      expect(JSON.stringify(tx.user.create.mock.calls)).not.toContain(
        'senha-forte-1',
      );
      expect(created).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain('argon2');
    });
  });
});
