import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { StockService } from './stock.service.js';

const gerente: AuthenticatedUser = {
  id: 'g1',
  name: 'Gerente',
  email: 'g@loja.com',
  role: 'GERENTE',
};

function setup() {
  const tx = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    product: { findUnique: vi.fn() },
    stockMovement: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => ({
        id: 'm1',
        ...data,
        product: { id: data.productId, sku: 'S', name: 'P' },
        user: { id: data.userId, name: 'Gerente' },
        createdAt: new Date(),
      })),
    },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { record: vi.fn() };
  const service = new StockService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, tx, audit };
}

describe('StockService', () => {
  describe('register: um campo por tipo', () => {
    it('AJUSTE com quantity: 400, sem abrir transação', async () => {
      const { service, tx } = setup();
      await expect(
        service.register(gerente, {
          productId: 'p1',
          type: 'AJUSTE',
          quantity: 3,
          reason: 'x',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('ENTRADA com countedStock: 400', async () => {
      const { service } = setup();
      await expect(
        service.register(gerente, {
          productId: 'p1',
          type: 'ENTRADA',
          quantity: 1,
          countedStock: 3,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('decrease (baixa atômica)', () => {
    const input = { productId: 'p1', quantity: 5, userId: 'g1', reason: 'x' };

    it('baixou: grava SAIDA com quantidade negativa e o saldo devolvido', async () => {
      const { service, tx } = setup();
      tx.$queryRaw.mockResolvedValue([{ current_stock: 3 }]);
      const movement = await service.decrease(tx as never, input);
      expect(movement).toMatchObject({
        type: 'SAIDA',
        quantity: -5,
        balanceAfter: 3,
      });
    });

    it('0 linhas e produto inexistente: 404', async () => {
      const { service, tx } = setup();
      tx.$queryRaw.mockResolvedValue([]);
      tx.product.findUnique.mockResolvedValue(null);
      await expect(service.decrease(tx as never, input)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('0 linhas e produto inativo: 409', async () => {
      const { service, tx } = setup();
      tx.$queryRaw.mockResolvedValue([]);
      tx.product.findUnique.mockResolvedValue({
        active: false,
        currentStock: 9,
      });
      await expect(service.decrease(tx as never, input)).rejects.toThrow(
        'Produto inativo não pode ter saída',
      );
    });

    it('0 linhas por falta de saldo: 409 com o disponível, sem gravar movimentação', async () => {
      const { service, tx } = setup();
      tx.$queryRaw.mockResolvedValue([]);
      tx.product.findUnique.mockResolvedValue({
        active: true,
        currentStock: 2,
      });

      const error = await service.decrease(tx as never, input).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        message: 'Estoque insuficiente',
        details: { productId: 'p1', requested: 5, available: 2 },
      });
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('adjust', () => {
    const input = { productId: 'p1', userId: 'g1', reason: 'Inventário' };

    it('grava a diferença entre o contado e o saldo travado', async () => {
      const { service, tx } = setup();
      tx.$queryRaw.mockResolvedValue([{ current_stock: 9 }]);
      const movement = await service.adjust(tx as never, {
        ...input,
        countedStock: 7,
      });
      expect(movement).toMatchObject({
        type: 'AJUSTE',
        quantity: -2,
        balanceAfter: 7,
      });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('contado igual ao saldo: 400, sem gravar nada', async () => {
      const { service, tx } = setup();
      tx.$queryRaw.mockResolvedValue([{ current_stock: 7 }]);
      await expect(
        service.adjust(tx as never, { ...input, countedStock: 7 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('auditoria', () => {
    it('ENTRADA não audita; SAIDA audita STOCK_MANUAL_EXIT', async () => {
      const { service, tx, audit } = setup();
      tx.$queryRaw.mockResolvedValue([{ current_stock: 10 }]);

      await service.register(gerente, {
        productId: 'p1',
        type: 'ENTRADA',
        quantity: 10,
      });
      expect(audit.record).not.toHaveBeenCalled();

      await service.register(gerente, {
        productId: 'p1',
        type: 'SAIDA',
        quantity: 1,
        reason: 'Avaria',
      });
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record.mock.calls[0][0].action).toBe('STOCK_MANUAL_EXIT');
    });
  });
});
