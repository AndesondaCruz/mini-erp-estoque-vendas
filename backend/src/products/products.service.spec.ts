import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { toDecimal } from '../common/money/money.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ProductsService, toProductDto } from './products.service.js';

const user = (role: AuthenticatedUser['role']): AuthenticatedUser => ({
  id: `${role}-1`,
  name: role,
  email: `${role.toLowerCase()}@loja.com`,
  role,
});

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    sku: 'CER-350',
    name: 'Cerveja',
    categoryId: 'c1',
    supplierId: null,
    costPrice: toDecimal('3.20'),
    salePrice: toDecimal('5.50'),
    minStock: 5,
    currentStock: 2,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    category: { id: 'c1', name: 'Bebidas' },
    supplier: null,
    ...overrides,
  };
}

function setup(current = makeProduct()) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    product: {
      findUnique: vi.fn().mockResolvedValue(current),
      update: vi.fn(),
    },
    supplier: { findUnique: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { record: vi.fn() };
  const service = new ProductsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, tx, audit };
}

const actions = (audit: { record: ReturnType<typeof vi.fn> }) =>
  audit.record.mock.calls.map(
    ([entry]) => (entry as { action: string }).action,
  );

describe('toProductDto', () => {
  it('VENDEDOR: a chave costPrice não existe no objeto', () => {
    const dto = toProductDto(makeProduct(), 'VENDEDOR');
    expect(Object.keys(dto)).not.toContain('costPrice');
    expect(dto.salePrice).toBe('5.50');
  });

  it.each(['ADMIN', 'GERENTE'] as const)('%s: recebe costPrice', (role) => {
    expect(toProductDto(makeProduct(), role).costPrice).toBe('3.20');
  });

  it('lowStock é verdadeiro quando o saldo é menor ou igual ao mínimo', () => {
    expect(
      toProductDto(makeProduct({ currentStock: 5 }), 'ADMIN').lowStock,
    ).toBe(true);
    expect(
      toProductDto(makeProduct({ currentStock: 6 }), 'ADMIN').lowStock,
    ).toBe(false);
  });
});

describe('ProductsService.update', () => {
  it('GERENTE enviando active: 403, sem abrir transação', async () => {
    const { service, tx } = setup();
    await expect(
      service.update(user('GERENTE'), 'p1', { active: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('trava a linha antes de ler o produto', async () => {
    const { service, tx } = setup();
    tx.product.update.mockResolvedValue(makeProduct({ name: 'X' }));
    await service.update(user('GERENTE'), 'p1', { name: 'X' });

    const lockOrder = tx.$queryRaw.mock.invocationCallOrder[0];
    const readOrder = tx.product.findUnique.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(readOrder);
  });

  it('preço mudou: audita PRODUCT_PRICE_CHANGED com antes e depois', async () => {
    const { service, tx, audit } = setup();
    tx.product.update.mockResolvedValue(
      makeProduct({ salePrice: toDecimal('6.00') }),
    );
    await service.update(user('GERENTE'), 'p1', { salePrice: '6.00' });

    expect(actions(audit)).toEqual(['PRODUCT_PRICE_CHANGED']);
    const [entry] = audit.record.mock.calls[0];
    expect(entry.before.salePrice).toBe('5.50');
    expect(entry.after.salePrice).toBe('6.00');
  });

  it('mesmo preço escrito de outro jeito ("5.5"): não audita', async () => {
    const { service, tx, audit } = setup();
    tx.product.update.mockResolvedValue(makeProduct());
    await service.update(user('GERENTE'), 'p1', { salePrice: '5.5' });
    expect(actions(audit)).toEqual([]);
  });

  it('desativar já inativo: não audita de novo', async () => {
    const inactive = makeProduct({ active: false });
    const { service, tx, audit } = setup(inactive);
    tx.product.update.mockResolvedValue(inactive);
    await service.deactivate(user('ADMIN'), 'p1');
    expect(actions(audit)).toEqual([]);
  });

  it('trocar para fornecedor inativo: 400', async () => {
    const { service, tx } = setup();
    tx.supplier.findUnique.mockResolvedValue({ active: false });
    await expect(
      service.update(user('GERENTE'), 'p1', { supplierId: 's2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.product.update).not.toHaveBeenCalled();
  });
});
