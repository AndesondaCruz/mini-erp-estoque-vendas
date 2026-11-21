/**
 * Popula o banco com os dados de demonstração (src/demo/demo-data.ts):
 * uma conta demo por papel, catálogo e cerca de 8 semanas de vendas.
 *
 *   Local:   npm run seed:demo            (banco vazio)
 *            npm run seed:demo -- --reset (APAGA TUDO e recria a demo)
 *   Docker:  docker compose exec api node dist/seed-demo.js --reset
 *
 * Grava direto no banco, sem passar pelos services, porque a história
 * precisa de datas no passado. Em troca, confere no final as mesmas regras
 * que os services garantem; se alguma falhar, a transação inteira é desfeita.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { PASSWORD_MIN } from './auth/dto/change-password.dto.js';
import { PasswordService } from './auth/password.service.js';
import {
  centsToDecimal,
  DEMO_ACCOUNTS,
  type DemoDataset,
  generateDemoData,
} from './demo/demo-data.js';
import { type Prisma, PrismaClient } from './generated/prisma/client.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DEMO_PASSWORD: z
      .string()
      .min(
        PASSWORD_MIN,
        `DEMO_PASSWORD precisa de ${PASSWORD_MIN}+ caracteres`,
      ),
  })
  .parse(process.env);

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== '--reset');
if (unknown.length > 0) {
  throw new Error(`Argumento desconhecido: ${unknown.join(' ')}`);
}
const reset = args.includes('--reset');

// Em produção, só um banco de demonstração pode ser apagado e repovoado.
if (env.NODE_ENV === 'production' && !env.DEMO_MODE) {
  throw new Error(
    '[seed:demo] Recusado: NODE_ENV=production sem DEMO_MODE=true. Este comando apaga dados.',
  );
}

const ALL_TABLES =
  'audit_logs, refresh_tokens, sale_items, stock_movements, sales, products, categories, suppliers, users';
const SOURCE = { source: 'demo-seed' };

type Tx = Prisma.TransactionClient;

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  const passwords = new PasswordService();
  const data = generateDemoData(new Date());

  // Hash fora da transação: argon2 é lento de propósito.
  const demoHash = await passwords.hash(env.DEMO_PASSWORD);
  // A conta comum recebe uma senha aleatória que ninguém conhece.
  const otherHash = await passwords.hash(randomBytes(24).toString('base64url'));

  try {
    await prisma.$transaction(
      async (tx) => {
        if (reset) {
          // TRUNCATE não dispara os triggers de "somente inserção" e, dentro
          // da transação, é desfeito junto se algo falhar depois.
          await tx.$executeRawUnsafe(
            `TRUNCATE TABLE ${ALL_TABLES} RESTART IDENTITY CASCADE`,
          );
        } else {
          await assertEmpty(tx);
        }
        await insertDataset(tx, data, demoHash, otherHash);
        await assertInvariants(tx);
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } finally {
    await prisma.$disconnect();
  }

  const canceled = data.sales.filter((s) => s.cancel).length;
  console.log(
    `[seed:demo] Pronto: ${data.products.length} produtos, ${data.sales.length} vendas (${canceled} canceladas), ${data.movements.length} movimentações.`,
  );
  console.log(
    `[seed:demo] Contas demo (senha em DEMO_PASSWORD): ${Object.values(DEMO_ACCOUNTS).join(', ')}`,
  );
}

async function assertEmpty(tx: Tx): Promise<void> {
  const [users, products, sales] = await Promise.all([
    tx.user.count(),
    tx.product.count(),
    tx.sale.count(),
  ]);
  if (users + products + sales > 0) {
    throw new Error(
      '[seed:demo] O banco já tem dados. Rode com --reset para APAGAR TUDO e recriar a demo.',
    );
  }
}

async function insertDataset(
  tx: Tx,
  data: DemoDataset,
  demoHash: string,
  otherHash: string,
): Promise<void> {
  const created = data.startedAt;
  const audits: Prisma.AuditLogCreateManyInput[] = [];

  // Usuários
  const userIds = new Map(data.users.map((u) => [u.email, randomUUID()]));
  const userId = (email: string): string => mustGet(userIds, email);
  await tx.user.createMany({
    data: data.users.map((u) => ({
      id: userId(u.email),
      name: u.name,
      email: u.email,
      role: u.role,
      isDemo: u.isDemo,
      passwordHash: u.isDemo ? demoHash : otherHash,
      createdAt: created,
    })),
  });
  for (const u of data.users) {
    audits.push({
      action: 'USER_CREATED',
      entity: 'User',
      entityId: userId(u.email),
      after: {
        id: userId(u.email),
        name: u.name,
        email: u.email,
        role: u.role,
      },
      metadata: SOURCE,
      createdAt: created,
    });
  }

  // Catálogo
  const categoryIds = new Map(data.categories.map((c) => [c, randomUUID()]));
  await tx.category.createMany({
    data: data.categories.map((name) => ({
      id: mustGet(categoryIds, name),
      name,
      createdAt: created,
    })),
  });
  const supplierIds = new Map(
    data.suppliers.map((s) => [s.name, randomUUID()]),
  );
  await tx.supplier.createMany({
    data: data.suppliers.map((s) => ({
      id: mustGet(supplierIds, s.name),
      name: s.name,
      phone: s.phone,
      email: s.email,
      createdAt: created,
    })),
  });

  const productIds = new Map(data.products.map((p) => [p.sku, randomUUID()]));
  const productId = (sku: string): string => mustGet(productIds, sku);
  const productNames = new Map(data.products.map((p) => [p.sku, p.name]));
  const productName = (sku: string): string => mustGet(productNames, sku);
  const adminId = userId(DEMO_ACCOUNTS.admin);
  await tx.product.createMany({
    data: data.products.map((p) => ({
      id: productId(p.sku),
      sku: p.sku,
      name: p.name,
      categoryId: mustGet(categoryIds, p.category),
      supplierId: p.supplier ? mustGet(supplierIds, p.supplier) : null,
      costPrice: centsToDecimal(p.costCents),
      salePrice: centsToDecimal(p.priceCents),
      minStock: p.minStock,
      currentStock: p.currentStock,
      active: p.active,
      createdAt: created,
    })),
  });
  for (const p of data.products) {
    audits.push({
      action: 'PRODUCT_CREATED',
      userId: adminId,
      entity: 'Product',
      entityId: productId(p.sku),
      after: {
        id: productId(p.sku),
        sku: p.sku,
        name: p.name,
        costPrice: centsToDecimal(p.costCents),
        salePrice: centsToDecimal(p.priceCents),
        active: p.active,
      },
      metadata: SOURCE,
      createdAt: created,
    });
  }

  // Vendas: o número é a posição cronológica (ref).
  const saleIds = new Map(data.sales.map((s) => [s.ref, randomUUID()]));
  const saleId = (ref: number): string => mustGet(saleIds, ref);
  await tx.sale.createMany({
    data: data.sales.map((s) => ({
      id: saleId(s.ref),
      number: s.ref,
      sellerId: userId(s.sellerEmail),
      total: centsToDecimal(s.totalCents),
      status: s.cancel ? 'CANCELADA' : 'CONCLUIDA',
      idempotencyKey: randomUUID(),
      createdAt: s.at,
      canceledAt: s.cancel?.at ?? null,
      canceledById: s.cancel ? userId(s.cancel.byEmail) : null,
      cancelReason: s.cancel?.reason ?? null,
    })),
  });
  // Com number explícito, a sequence não andou: a próxima venda da API
  // continua a partir da última venda da demo.
  await tx.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('sales', 'number'), (SELECT COALESCE(MAX(number), 0) + 1 FROM sales), false)`,
  );
  await tx.saleItem.createMany({
    data: data.sales.flatMap((s) =>
      s.items.map((i) => ({
        saleId: saleId(s.ref),
        productId: productId(i.sku),
        quantity: i.quantity,
        unitPrice: centsToDecimal(i.unitPriceCents),
        unitCost: centsToDecimal(i.unitCostCents),
        subtotal: centsToDecimal(i.subtotalCents),
      })),
    ),
  });
  for (const s of data.sales) {
    const id = saleId(s.ref);
    const total = centsToDecimal(s.totalCents);
    audits.push({
      action: 'SALE_CREATED',
      userId: userId(s.sellerEmail),
      entity: 'Sale',
      entityId: id,
      after: {
        id,
        number: s.ref,
        sellerId: userId(s.sellerEmail),
        total,
        status: 'CONCLUIDA',
        items: s.items.map((i) => ({
          productId: productId(i.sku),
          sku: i.sku,
          name: productName(i.sku),
          quantity: i.quantity,
          unitPrice: centsToDecimal(i.unitPriceCents),
        })),
      },
      metadata: SOURCE,
      createdAt: s.at,
    });
    if (s.cancel) {
      const canceledById = userId(s.cancel.byEmail);
      audits.push({
        action: 'SALE_CANCELED',
        userId: canceledById,
        entity: 'Sale',
        entityId: id,
        before: { id, number: s.ref, status: 'CONCLUIDA' },
        after: {
          id,
          number: s.ref,
          status: 'CANCELADA',
          total,
          canceledAt: s.cancel.at.toISOString(),
          canceledById,
          cancelReason: s.cancel.reason,
        },
        metadata: SOURCE,
        createdAt: s.cancel.at,
      });
    }
  }

  // Movimentações de estoque
  const movements = data.movements.map((m) => ({ id: randomUUID(), ...m }));
  await tx.stockMovement.createMany({
    data: movements.map((m) => ({
      id: m.id,
      productId: productId(m.sku),
      type: m.type,
      quantity: m.quantity,
      balanceAfter: m.balanceAfter,
      reason: m.reason,
      saleId: m.saleRef === null ? null : saleId(m.saleRef),
      userId: userId(m.userEmail),
      createdAt: m.at,
    })),
  });
  for (const m of movements.filter((mv) => mv.type === 'AJUSTE')) {
    audits.push({
      action: 'STOCK_ADJUSTED',
      userId: userId(m.userEmail),
      entity: 'StockMovement',
      entityId: m.id,
      after: {
        id: m.id,
        productId: productId(m.sku),
        type: m.type,
        quantity: m.quantity,
        balanceAfter: m.balanceAfter,
        reason: m.reason,
      },
      metadata: SOURCE,
      createdAt: m.at,
    });
  }

  audits.sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));
  await tx.auditLog.createMany({ data: audits });
}

/** As mesmas regras que os services garantem, conferidas no banco. */
async function assertInvariants(tx: Tx): Promise<void> {
  const checks: { name: string; sql: string }[] = [
    {
      name: 'saldo do produto diferente da soma das movimentações',
      sql: `SELECT p.sku AS ref FROM products p
            LEFT JOIN stock_movements m ON m.product_id = p.id
            GROUP BY p.id
            HAVING p.current_stock <> COALESCE(SUM(m.quantity), 0)`,
    },
    {
      name: 'balance_after diferente da soma corrente',
      sql: `SELECT id::text AS ref FROM (
              SELECT id, balance_after,
                     SUM(quantity) OVER (PARTITION BY product_id ORDER BY created_at, id) AS running
              FROM stock_movements) t
            WHERE running <> balance_after OR balance_after < 0`,
    },
    {
      name: 'total da venda diferente da soma dos itens',
      sql: `SELECT s.number::text AS ref FROM sales s
            JOIN sale_items i ON i.sale_id = s.id
            GROUP BY s.id
            HAVING s.total <> SUM(i.subtotal)`,
    },
  ];
  for (const check of checks) {
    const rows = await tx.$queryRawUnsafe<{ ref: string }[]>(check.sql);
    if (rows.length > 0) {
      throw new Error(
        `[seed:demo] Dados inconsistentes (${check.name}): ${rows
          .slice(0, 5)
          .map((r) => r.ref)
          .join(', ')}`,
      );
    }
  }
}

function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined)
    throw new Error(`[seed:demo] Chave ausente: ${String(key)}`);
  return value;
}

function toTime(value: Date | string | undefined): number {
  return value === undefined ? 0 : new Date(value).getTime();
}

await main();
