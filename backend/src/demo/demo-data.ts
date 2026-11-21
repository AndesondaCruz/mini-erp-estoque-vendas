/**
 * Gera, em memória e sem banco, os dados de demonstração: catálogo, usuários
 * e cerca de 8 semanas de história (entradas, vendas, cancelamentos e
 * ajustes), já com o saldo depois de cada movimentação.
 *
 * Por que gerar tudo antes de gravar: stock_movements e audit_logs são só
 * inserção (trigger no banco), então a história não pode ser criada "agora"
 * e depois ter a data corrigida com UPDATE. Ela nasce com a data certa, em
 * ordem cronológica, e o seed só copia o resultado para o banco.
 *
 * É determinístico: a mesma semente e o mesmo "agora" geram os mesmos dados.
 * As datas são relativas a "agora", para os relatórios dos últimos 30 dias
 * nunca ficarem vazios.
 */
import type { Role, StockMovementType } from '../generated/prisma/enums.js';

export const DEMO_DAYS = 56;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
// America/Fortaleza: UTC-3, sem horário de verão. O horário da loja (8h às
// 20h) é calculado neste fuso para as vendas caírem no dia certo do relatório.
const UTC_OFFSET_MS = -3 * HOUR_MS;

// ---------------------------------------------------------------------------
// Tipos do resultado
// ---------------------------------------------------------------------------

export interface DemoUserSeed {
  name: string;
  email: string;
  role: Role;
  /** true: conta pública da demo, protegida pelo DEMO_MODE. */
  isDemo: boolean;
}

export interface DemoSupplierSeed {
  name: string;
  phone: string;
  email: string;
}

export interface DemoProductSeed {
  sku: string;
  name: string;
  category: string;
  supplier: string | null;
  costCents: number;
  priceCents: number;
  minStock: number;
  active: boolean;
  /** Saldo final: a soma de todas as movimentações do produto. */
  currentStock: number;
}

export interface DemoSaleItemSeed {
  sku: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  subtotalCents: number;
}

export interface DemoSaleSeed {
  /** Posição cronológica (1, 2, 3...): vira o número da venda. */
  ref: number;
  at: Date;
  sellerEmail: string;
  items: DemoSaleItemSeed[];
  totalCents: number;
  cancel: { at: Date; byEmail: string; reason: string } | null;
}

export interface DemoMovementSeed {
  at: Date;
  sku: string;
  type: StockMovementType;
  /** Com sinal: positivo soma ao saldo, negativo subtrai. */
  quantity: number;
  balanceAfter: number;
  reason: string | null;
  userEmail: string;
  /** ref da venda, nas saídas por venda e nos estornos. */
  saleRef: number | null;
}

export interface DemoDataset {
  users: DemoUserSeed[];
  categories: string[];
  suppliers: DemoSupplierSeed[];
  products: DemoProductSeed[];
  sales: DemoSaleSeed[];
  movements: DemoMovementSeed[];
  /** Instante em que a loja "abriu": catálogo e usuários são criados antes. */
  startedAt: Date;
}

// ---------------------------------------------------------------------------
// Catálogo fixo de um pequeno mercado
// ---------------------------------------------------------------------------

export const DEMO_ACCOUNTS = {
  admin: 'admin.demo@example.com',
  manager: 'gerente.demo@example.com',
  seller: 'vendedor.demo@example.com',
} as const;

/** Vendedora comum (não demo): o visitante pode editá-la e desativá-la. */
const EXTRA_SELLER = 'carla.souza@example.com';

const USERS: DemoUserSeed[] = [
  {
    name: 'Ana Admin (demo)',
    email: DEMO_ACCOUNTS.admin,
    role: 'ADMIN',
    isDemo: true,
  },
  {
    name: 'Gustavo Gerente (demo)',
    email: DEMO_ACCOUNTS.manager,
    role: 'GERENTE',
    isDemo: true,
  },
  {
    name: 'Vitor Vendedor (demo)',
    email: DEMO_ACCOUNTS.seller,
    role: 'VENDEDOR',
    isDemo: true,
  },
  { name: 'Carla Souza', email: EXTRA_SELLER, role: 'VENDEDOR', isDemo: false },
];

const SUPPLIERS: DemoSupplierSeed[] = [
  {
    name: 'Litoral Distribuidora de Bebidas',
    phone: '84999990001',
    email: 'pedidos@litoral-bebidas.example.com',
  },
  {
    name: 'Comercial Oeste Alimentos',
    phone: '84999990002',
    email: 'vendas@oeste-alimentos.example.com',
  },
  {
    name: 'Higiclean Distribuidora',
    phone: '84999990003',
    email: 'contato@higiclean.example.com',
  },
];

interface CatalogEntry {
  sku: string;
  name: string;
  category: string;
  supplier: string | null;
  costCents: number;
  priceCents: number;
  minStock: number;
  initialStock: number;
  restockQty: number;
  /** Peso relativo na escolha dos itens de uma venda. */
  popularity: number;
  /** Maior quantidade deste item numa venda. */
  maxPerSale: number;
  /** Sem reposição nas 2 últimas semanas: termina abaixo do mínimo. */
  endsLow?: boolean;
  active?: boolean;
}

const [BEBIDAS, ALIMENTOS, LIMPEZA] = SUPPLIERS.map((s) => s.name);

// prettier-ignore
const CATALOG: CatalogEntry[] = [
  // Bebidas
  { sku: 'BEB-COLA-2L', name: 'Refrigerante de cola 2 L', category: 'Bebidas', supplier: BEBIDAS, costCents: 699, priceCents: 999, minStock: 12, initialStock: 48, restockQty: 48, popularity: 10, maxPerSale: 3 },
  { sku: 'BEB-GUAR-2L', name: 'Refrigerante de guaraná 2 L', category: 'Bebidas', supplier: BEBIDAS, costCents: 549, priceCents: 849, minStock: 12, initialStock: 36, restockQty: 36, popularity: 8, maxPerSale: 3 },
  { sku: 'BEB-AGUA-500', name: 'Água mineral 500 ml', category: 'Bebidas', supplier: BEBIDAS, costCents: 99, priceCents: 250, minStock: 24, initialStock: 96, restockQty: 96, popularity: 9, maxPerSale: 6 },
  { sku: 'BEB-CERV-350', name: 'Cerveja lata 350 ml', category: 'Bebidas', supplier: BEBIDAS, costCents: 289, priceCents: 449, minStock: 24, initialStock: 120, restockQty: 120, popularity: 10, maxPerSale: 12 },
  { sku: 'BEB-SUCO-1L', name: 'Suco de uva integral 1 L', category: 'Bebidas', supplier: BEBIDAS, costCents: 899, priceCents: 1399, minStock: 6, initialStock: 18, restockQty: 18, popularity: 3, maxPerSale: 2, endsLow: true },
  { sku: 'BEB-ENER-250', name: 'Energético 250 ml (fora de linha)', category: 'Bebidas', supplier: BEBIDAS, costCents: 549, priceCents: 899, minStock: 0, initialStock: 0, restockQty: 0, popularity: 0, maxPerSale: 0, active: false },
  // Mercearia
  { sku: 'MER-ARROZ-5K', name: 'Arroz branco tipo 1 5 kg', category: 'Mercearia', supplier: ALIMENTOS, costCents: 2190, priceCents: 2890, minStock: 8, initialStock: 30, restockQty: 30, popularity: 6, maxPerSale: 2 },
  { sku: 'MER-FEIJ-1K', name: 'Feijão carioca 1 kg', category: 'Mercearia', supplier: ALIMENTOS, costCents: 690, priceCents: 949, minStock: 10, initialStock: 40, restockQty: 40, popularity: 6, maxPerSale: 3 },
  { sku: 'MER-CAFE-500', name: 'Café torrado e moído 500 g', category: 'Mercearia', supplier: ALIMENTOS, costCents: 1590, priceCents: 2199, minStock: 8, initialStock: 30, restockQty: 24, popularity: 7, maxPerSale: 2 },
  { sku: 'MER-ACUC-1K', name: 'Açúcar cristal 1 kg', category: 'Mercearia', supplier: ALIMENTOS, costCents: 449, priceCents: 649, minStock: 10, initialStock: 30, restockQty: 30, popularity: 5, maxPerSale: 3 },
  { sku: 'MER-OLEO-900', name: 'Óleo de soja 900 ml', category: 'Mercearia', supplier: ALIMENTOS, costCents: 699, priceCents: 949, minStock: 10, initialStock: 30, restockQty: 30, popularity: 5, maxPerSale: 2 },
  { sku: 'MER-MAC-500', name: 'Macarrão espaguete 500 g', category: 'Mercearia', supplier: ALIMENTOS, costCents: 389, priceCents: 579, minStock: 12, initialStock: 40, restockQty: 40, popularity: 5, maxPerSale: 3 },
  { sku: 'MER-PAO-400', name: 'Pão de forma 400 g', category: 'Mercearia', supplier: null, costCents: 649, priceCents: 949, minStock: 6, initialStock: 20, restockQty: 20, popularity: 6, maxPerSale: 2 },
  // Limpeza
  { sku: 'LIM-DET-500', name: 'Detergente líquido 500 ml', category: 'Limpeza', supplier: LIMPEZA, costCents: 199, priceCents: 349, minStock: 12, initialStock: 48, restockQty: 48, popularity: 5, maxPerSale: 3 },
  { sku: 'LIM-SAB-1K', name: 'Sabão em pó 1 kg', category: 'Limpeza', supplier: LIMPEZA, costCents: 1190, priceCents: 1690, minStock: 6, initialStock: 20, restockQty: 20, popularity: 3, maxPerSale: 1, endsLow: true },
  { sku: 'LIM-AGSA-1L', name: 'Água sanitária 1 L', category: 'Limpeza', supplier: LIMPEZA, costCents: 349, priceCents: 549, minStock: 8, initialStock: 24, restockQty: 24, popularity: 3, maxPerSale: 2 },
  // Higiene (comprado no atacarejo, sem fornecedor cadastrado)
  { sku: 'HIG-PAP-12', name: 'Papel higiênico 12 rolos', category: 'Higiene', supplier: null, costCents: 1690, priceCents: 2390, minStock: 6, initialStock: 20, restockQty: 20, popularity: 4, maxPerSale: 1 },
  { sku: 'HIG-SAB-90', name: 'Sabonete 90 g', category: 'Higiene', supplier: null, costCents: 189, priceCents: 329, minStock: 12, initialStock: 48, restockQty: 48, popularity: 4, maxPerSale: 4 },
  { sku: 'HIG-CREM-90', name: 'Creme dental 90 g', category: 'Higiene', supplier: null, costCents: 399, priceCents: 649, minStock: 10, initialStock: 30, restockQty: 30, popularity: 4, maxPerSale: 2, endsLow: true },
];

/** Ajustes de inventário em dias fixos (dia 0 = primeiro dia da história). */
// prettier-ignore
const ADJUSTMENTS = [
  { day: 10, sku: 'BEB-CERV-350', delta: -2, reason: 'Avaria: latas amassadas no recebimento' },
  { day: 24, sku: 'MER-OLEO-900', delta: -1, reason: 'Avaria: embalagem vazando' },
  { day: 38, sku: 'HIG-SAB-90', delta: 2, reason: 'Contagem de inventário' },
  { day: 50, sku: 'BEB-AGUA-500', delta: -3, reason: 'Contagem de inventário' },
];

const CANCEL_REASONS = [
  'Cliente desistiu da compra',
  'Produto lançado errado no caixa',
  'Pagamento recusado no cartão',
];

/** Peso de cada vendedor nas vendas. */
const SELLERS = [
  { email: DEMO_ACCOUNTS.seller, weight: 55 },
  { email: EXTRA_SELLER, weight: 35 },
  { email: DEMO_ACCOUNTS.manager, weight: 10 },
];

/** Vendas por dia da semana (0 = domingo), antes da tendência de alta. */
const SALES_PER_WEEKDAY = [4, 7, 7, 7, 8, 10, 12];
const CANCEL_PROBABILITY = 0.015;

// ---------------------------------------------------------------------------
// Aleatoriedade com semente
// ---------------------------------------------------------------------------

/** mulberry32: PRNG pequeno e rápido. Mesma semente, mesma sequência. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Random {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Inteiro entre min e max, inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    const total = items.reduce((sum, item) => sum + weight(item), 0);
    let target = this.next() * total;
    for (const item of items) {
      target -= weight(item);
      if (target < 0) return item;
    }
    return items[items.length - 1];
  }
}

// ---------------------------------------------------------------------------
// Simulação
// ---------------------------------------------------------------------------

/** Instante UTC da meia-noite local (UTC-3) do dia de `date`. */
function localMidnight(date: Date): number {
  const local = date.getTime() + UTC_OFFSET_MS;
  return local - (local % DAY_MS) - UTC_OFFSET_MS;
}

/** Instante UTC de `hours` horas locais no dia que começa em `dayStart`. */
function atLocal(dayStart: number, hours: number): number {
  return dayStart + hours * HOUR_MS;
}

function localWeekday(dayStart: number): number {
  return new Date(dayStart + UTC_OFFSET_MS + 12 * HOUR_MS).getUTCDay();
}

interface PendingCancel {
  at: number;
  sale: DemoSaleSeed;
}

export function generateDemoData(now: Date, seed = 20261121): DemoDataset {
  const random = new Random(seed);
  const nowMs = now.getTime();
  const firstDay = localMidnight(now) - (DEMO_DAYS - 1) * DAY_MS;

  const balances = new Map(CATALOG.map((p) => [p.sku, 0]));
  const movements: DemoMovementSeed[] = [];
  const sales: DemoSaleSeed[] = [];
  let invoice = 4120;

  const move = (
    at: number,
    sku: string,
    type: StockMovementType,
    quantity: number,
    userEmail: string,
    reason: string | null,
    saleRef: number | null = null,
  ): void => {
    const balanceAfter = (balances.get(sku) ?? 0) + quantity;
    if (balanceAfter < 0) {
      throw new Error(`Saldo negativo gerado para ${sku}`);
    }
    balances.set(sku, balanceAfter);
    movements.push({
      at: new Date(at),
      sku,
      type,
      quantity,
      balanceAfter,
      reason,
      userEmail,
      saleRef,
    });
  };

  const sellable = CATALOG.filter((p) => p.active !== false);

  const makeSale = (at: number): DemoSaleSeed | null => {
    const seller = random.weighted(SELLERS, (s) => s.weight).email;
    const wanted = random.int(1, 4);
    const items: DemoSaleItemSeed[] = [];
    for (let i = 0; i < wanted; i++) {
      const candidates = sellable.filter(
        (p) =>
          (balances.get(p.sku) ?? 0) > 0 &&
          !items.some((item) => item.sku === p.sku),
      );
      if (candidates.length === 0) break;
      const product = random.weighted(candidates, (p) => p.popularity);
      const quantity = Math.min(
        random.int(1, product.maxPerSale),
        balances.get(product.sku) ?? 0,
      );
      items.push({
        sku: product.sku,
        quantity,
        unitPriceCents: product.priceCents,
        unitCostCents: product.costCents,
        subtotalCents: product.priceCents * quantity,
      });
    }
    if (items.length === 0) return null;

    const sale: DemoSaleSeed = {
      ref: sales.length + 1,
      at: new Date(at),
      sellerEmail: seller,
      items,
      totalCents: items.reduce((sum, item) => sum + item.subtotalCents, 0),
      cancel: null,
    };
    sales.push(sale);
    for (const item of items) {
      move(at, item.sku, 'SAIDA', -item.quantity, seller, null, sale.ref);
    }
    return sale;
  };

  const cancelSale = ({ at, sale }: PendingCancel): void => {
    const byEmail = random.pick([DEMO_ACCOUNTS.manager, DEMO_ACCOUNTS.admin]);
    const reason = random.pick(CANCEL_REASONS);
    sale.cancel = { at: new Date(at), byEmail, reason };
    for (const item of sale.items) {
      move(at, item.sku, 'ESTORNO', item.quantity, byEmail, reason, sale.ref);
    }
  };

  for (let day = 0; day < DEMO_DAYS; day++) {
    const dayStart = firstDay + day * DAY_MS;
    const isLastDay = day === DEMO_DAYS - 1;

    // 7h: estoque inicial no primeiro dia; reposições nos demais.
    for (const product of sellable) {
      if (day === 0) {
        move(
          atLocal(dayStart, 7),
          product.sku,
          'ENTRADA',
          product.initialStock,
          DEMO_ACCOUNTS.manager,
          'Estoque inicial',
        );
        continue;
      }
      const low = (balances.get(product.sku) ?? 0) <= product.minStock;
      const holdsBack = product.endsLow && day >= DEMO_DAYS - 14;
      if (low && !holdsBack && atLocal(dayStart, 7.5) <= nowMs) {
        move(
          atLocal(dayStart, 7.5),
          product.sku,
          'ENTRADA',
          product.restockQty,
          DEMO_ACCOUNTS.manager,
          `Reposição - NF ${invoice++}`,
        );
      }
    }

    // Vendas das 8h às 20h, em horários aleatórios e em ordem.
    const trend = 0.8 + (0.4 * day) / (DEMO_DAYS - 1);
    const base = SALES_PER_WEEKDAY[localWeekday(dayStart)];
    const count = Math.max(1, Math.round((base + random.int(-2, 2)) * trend));
    const saleTimes = Array.from(
      { length: count },
      () => atLocal(dayStart, 8) + random.int(0, 12 * HOUR_MS - 1),
    )
      .filter((at) => at <= nowMs)
      .sort((a, b) => a - b);

    const adjustment = ADJUSTMENTS.find((a) => a.day === day);
    const adjustmentAt = atLocal(dayStart, 18.5);

    // Processa vendas, cancelamentos e o ajuste do dia em ordem de horário:
    // um estorno devolve estoque que uma venda seguinte pode usar.
    const pending: PendingCancel[] = [];
    let adjusted = !adjustment || adjustmentAt > nowMs;
    let next = 0;
    while (next < saleTimes.length || pending.length > 0 || !adjusted) {
      const saleAt = saleTimes[next] ?? Infinity;
      const cancelAt = pending[0]?.at ?? Infinity;
      const adjustAt = adjusted ? Infinity : adjustmentAt;
      const first = Math.min(saleAt, cancelAt, adjustAt);

      if (first === adjustAt && adjustment) {
        const current = balances.get(adjustment.sku) ?? 0;
        const counted = Math.max(0, current + adjustment.delta);
        if (counted !== current) {
          move(
            adjustAt,
            adjustment.sku,
            'AJUSTE',
            counted - current,
            DEMO_ACCOUNTS.manager,
            adjustment.reason,
          );
        }
        adjusted = true;
      } else if (first === cancelAt) {
        cancelSale(pending.shift() as PendingCancel);
      } else {
        next++;
        const sale = makeSale(saleAt);
        // O dia de hoje não tem cancelamento: a venda ainda pode ser recente.
        if (sale && !isLastDay && random.chance(CANCEL_PROBABILITY)) {
          pending.push({
            at: saleAt + random.int(15, 90) * MINUTE_MS,
            sale,
          });
          pending.sort((a, b) => a.at - b.at);
        }
      }
    }
  }

  return {
    users: USERS,
    categories: [...new Set(CATALOG.map((p) => p.category))],
    suppliers: SUPPLIERS,
    products: CATALOG.map((p) => ({
      sku: p.sku,
      name: p.name,
      category: p.category,
      supplier: p.supplier,
      costCents: p.costCents,
      priceCents: p.priceCents,
      minStock: p.minStock,
      active: p.active !== false,
      currentStock: balances.get(p.sku) ?? 0,
    })),
    sales,
    movements,
    startedAt: new Date(atLocal(firstDay, 6)),
  };
}

/** Centavos para o texto decimal que o Prisma grava em Decimal(12, 2). */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
