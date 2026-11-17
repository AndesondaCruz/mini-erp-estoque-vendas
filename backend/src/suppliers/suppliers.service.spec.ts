import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Supplier } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SuppliersService } from './suppliers.service.js';

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 's1',
    name: 'Fornecedor',
    document: null,
    phone: null,
    email: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('erro simulado', {
    code,
    clientVersion: 'test',
  });

function setup() {
  const prisma = {
    supplier: {
      create: vi.fn().mockResolvedValue(makeSupplier()),
      update: vi.fn().mockResolvedValue(makeSupplier()),
      findUnique: vi.fn(),
    },
  };
  const service = new SuppliersService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('SuppliersService', () => {
  describe('update', () => {
    it('corpo sem nenhum campo: 400, sem tocar no banco', async () => {
      const { service, prisma } = setup();
      await expect(service.update('s1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });

    it('null apaga o campo; ausente fica undefined (não altera)', async () => {
      const { service, prisma } = setup();
      await service.update('s1', { phone: null });

      const { data } = prisma.supplier.update.mock.calls[0][0];
      expect(data.phone).toBeNull();
      expect(data.email).toBeUndefined();
      expect(data.name).toBeUndefined();
    });

    it('grava só os campos conhecidos (proteção contra mass assignment)', async () => {
      const { service, prisma } = setup();
      const dto = { name: 'Novo', createdAt: new Date(0) } as never;
      await service.update('s1', dto);

      const { data } = prisma.supplier.update.mock.calls[0][0];
      expect(Object.keys(data).sort()).toEqual(
        ['active', 'document', 'email', 'name', 'phone'].sort(),
      );
    });

    it('CNPJ duplicado (P2002): 409', async () => {
      const { service, prisma } = setup();
      prisma.supplier.update.mockRejectedValue(prismaError('P2002'));
      await expect(
        service.update('s1', { document: '11222333000181' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('deactivate', () => {
    it('grava active=false em vez de apagar', async () => {
      const { service, prisma } = setup();
      await service.deactivate('s1');
      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { active: false },
      });
    });

    it('fornecedor inexistente (P2025): 404', async () => {
      const { service, prisma } = setup();
      prisma.supplier.update.mockRejectedValue(prismaError('P2025'));
      await expect(service.deactivate('s1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  it('erro desconhecido do banco passa adiante sem ser mascarado', async () => {
    const { service, prisma } = setup();
    const unexpected = new Error('conexão perdida');
    prisma.supplier.create.mockRejectedValue(unexpected);
    await expect(service.create({ name: 'X' })).rejects.toBe(unexpected);
  });
});
