import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { toDecimal } from '../common/money/money.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StockService } from '../stock/stock.service.js';
import { SalesService, sortByProductId, toSaleDto } from './sales.service.js';

const seller: AuthenticatedUser = {
  id: 'v1',
  name: 'Vendedor',
  email: 'v@loja.com',
  role: 'VENDEDOR',
};

function makeSale(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    number: 1,
    sellerId: 'v1',
    total: toDecimal('11.00'),
    status: 'CONCLUIDA' as const,
    idempotencyKey: 'k1',
    createdAt: new Date(),
    canceledAt: null,
    canceledById: null,
    cancelReason: null,
    seller: { id: 'v1', name: 'Vendedor' },
    canceledBy: null,
    items: [
      {
        id: 'i1',
        saleId: 's1',
        productId: 'p1',
        quantity: 2,
        unitPrice: toDecimal('5.50'),
        unitCost: toDecimal('3.20'),
        subtotal: toDecimal('11.00'),
        product: { id: 'p1', sku: 'A', name: 'Produto A' },
      },
    ],
    ...overrides,
  };
}

function setup() {
  const tx = {
    sale: {
      create: vi.fn().mockResolvedValue({ id: 's1' }),
      update: vi.fn().mockResolvedValue(makeSale()),
    },
    saleItem: { create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    sale: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const stock = {
    decreaseReturningPrices: vi.fn().mockResolvedValue({
      salePrice: toDecimal('5.50'),
      costPrice: toDecimal('3.20'),
    }),
  };
  const audit = { record: vi.fn() };
  const service = new SalesService(
    prisma as unknown as PrismaService,
    stock as unknown as StockService,
    audit as unknown as AuditService,
  );
  return { service, prisma, tx, stock };
}

describe('sortByProductId', () => {
  it('ordena sem alterar a lista original', () => {
    const items = [{ productId: 'c' }, { productId: 'a' }, { productId: 'b' }];
    expect(sortByProductId(items).map((i) => i.productId)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(items[0].productId).toBe('c');
  });
});

describe('toSaleDto', () => {
  it('VENDEDOR não recebe unitCost; GERENTE recebe', () => {
    expect(toSaleDto(makeSale(), 'VENDEDOR').items[0]).not.toHaveProperty(
      'unitCost',
    );
    expect(toSaleDto(makeSale(), 'GERENTE').items[0].unitCost).toBe('3.20');
  });
});

describe('SalesService.create', () => {
  const items = [
    { productId: 'p2', quantity: 1 },
    { productId: 'p1', quantity: 2 },
  ];

  it('baixa os itens em ordem de productId, dentro da transação', async () => {
    const { service, stock } = setup();
    await service.create(seller, 'k1', { items });
    const order = stock.decreaseReturningPrices.mock.calls.map(
      ([, input]) => (input as { productId: string }).productId,
    );
    expect(order).toEqual(['p1', 'p2']);
  });

  it('grava a venda antes de baixar o estoque', async () => {
    const { service, tx, stock } = setup();
    await service.create(seller, 'k1', { items });
    expect(tx.sale.create.mock.invocationCallOrder[0]).toBeLessThan(
      stock.decreaseReturningPrices.mock.invocationCallOrder[0],
    );
  });

  it('total = soma de quantidade x preço lido na baixa', async () => {
    const { service, tx } = setup();
    await service.create(seller, 'k1', { items });
    const { data } = tx.sale.update.mock.calls[0][0];
    expect((data.total as Prisma.Decimal).toFixed(2)).toBe('16.50');
  });

  describe('idempotência', () => {
    it('mesma chave, mesmo vendedor e itens: devolve sem abrir transação', async () => {
      const { service, prisma } = setup();
      prisma.sale.findUnique.mockResolvedValue(makeSale());
      const result = await service.create(seller, 'k1', {
        items: [{ productId: 'p1', quantity: 2 }],
      });
      expect(result.created).toBe(false);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      [
        'outra quantidade',
        { items: [{ productId: 'p1', quantity: 3 }] },
        seller,
      ],
      [
        'outro vendedor',
        { items: [{ productId: 'p1', quantity: 2 }] },
        { ...seller, id: 'v2' },
      ],
    ])('chave reutilizada (%s): 409', async (_, dto, actor) => {
      const { service, prisma } = setup();
      prisma.sale.findUnique.mockResolvedValue(makeSale());
      await expect(service.create(actor, 'k1', dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('perdeu a corrida (P2002): devolve a venda vencedora', async () => {
      const { service, prisma } = setup();
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      prisma.sale.findUnique
        .mockResolvedValueOnce(null) // caminho rápido: ainda não existia
        .mockResolvedValueOnce(makeSale()); // depois da corrida: já existe
      const result = await service.create(seller, 'k1', {
        items: [{ productId: 'p1', quantity: 2 }],
      });
      expect(result).toMatchObject({ created: false, sale: { id: 's1' } });
    });
  });
});

describe('SalesService.cancel', () => {
  const manager: AuthenticatedUser = { ...seller, id: 'g1', role: 'GERENTE' };

  function setupCancel(updatedRows: { id: string }[]) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue(updatedRows),
      sale: {
        count: vi.fn().mockResolvedValue(0),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue(
            makeSale({ status: 'CANCELADA', canceledAt: new Date() }),
          ),
      },
      saleItem: {
        findMany: vi.fn().mockResolvedValue([
          { productId: 'p1', quantity: 2 },
          { productId: 'p2', quantity: 1 },
        ]),
      },
    };
    const prisma = {
      $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const stock = { increase: vi.fn() };
    const audit = { record: vi.fn() };
    const service = new SalesService(
      prisma as unknown as PrismaService,
      stock as unknown as StockService,
      audit as unknown as AuditService,
    );
    return { service, tx, stock, audit };
  }

  it('estorna cada item com ESTORNO, ligado à venda e com o motivo', async () => {
    const { service, stock, audit } = setupCancel([{ id: 's1' }]);
    await service.cancel(manager, 's1', { reason: 'Desistiu' });

    expect(stock.increase).toHaveBeenCalledTimes(2);
    expect(stock.increase.mock.calls[0].slice(1)).toEqual([
      'ESTORNO',
      {
        productId: 'p1',
        quantity: 2,
        userId: 'g1',
        reason: 'Desistiu',
        saleId: 's1',
      },
    ]);
    expect(audit.record.mock.calls[0][0].action).toBe('SALE_CANCELED');
  });

  it('busca os itens em ordem de productId (mesma ordem da venda)', async () => {
    const { service, tx } = setupCancel([{ id: 's1' }]);
    await service.cancel(manager, 's1', { reason: 'x' });
    expect(tx.saleItem.findMany).toHaveBeenCalledWith({
      where: { saleId: 's1' },
      orderBy: { productId: 'asc' },
    });
  });

  it('0 linhas e a venda existe: 409, sem estornar nada', async () => {
    const { service, tx, stock } = setupCancel([]);
    tx.sale.count.mockResolvedValue(1);
    await expect(
      service.cancel(manager, 's1', { reason: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stock.increase).not.toHaveBeenCalled();
  });

  it('0 linhas e a venda não existe: 404', async () => {
    const { service } = setupCancel([]);
    await expect(
      service.cancel(manager, 's1', { reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
