import {
  centsToDecimal,
  DEMO_ACCOUNTS,
  DEMO_DAYS,
  type DemoDataset,
  generateDemoData,
} from './demo-data.js';

// Um sábado às 15h em Fortaleza (18h UTC): fixo para o teste ser estável.
const NOW = new Date('2026-11-21T18:00:00.000Z');

describe('generateDemoData', () => {
  let data: DemoDataset;

  beforeAll(() => {
    data = generateDemoData(NOW);
  });

  it('é determinístico: mesma semente e mesmo "agora", mesmos dados', () => {
    expect(generateDemoData(NOW)).toEqual(data);
    expect(generateDemoData(NOW, 1)).not.toEqual(data);
  });

  it('nada fica no futuro nem antes do início da história', () => {
    const times = [
      ...data.movements.map((m) => m.at),
      ...data.sales.map((s) => s.at),
      ...data.sales.flatMap((s) => (s.cancel ? [s.cancel.at] : [])),
    ].map((d) => d.getTime());

    expect(Math.max(...times)).toBeLessThanOrEqual(NOW.getTime());
    expect(Math.min(...times)).toBeGreaterThan(data.startedAt.getTime());
    expect(NOW.getTime() - data.startedAt.getTime()).toBeLessThan(
      DEMO_DAYS * 24 * 60 * 60 * 1000,
    );
  });

  it('por produto: balanceAfter é a soma corrente, nunca negativa, e fecha com o saldo final', () => {
    for (const product of data.products) {
      const own = data.movements.filter((m) => m.sku === product.sku);
      let balance = 0;
      let lastAt = -Infinity;
      for (const movement of own) {
        // Estritamente crescente: o banco ordena por created_at, sem empate.
        expect(movement.at.getTime()).toBeGreaterThan(lastAt);
        lastAt = movement.at.getTime();
        balance += movement.quantity;
        expect(movement.balanceAfter).toBe(balance);
        expect(balance).toBeGreaterThanOrEqual(0);
      }
      expect(product.currentStock).toBe(balance);
    }
  });

  it('o sinal da quantidade combina com o tipo da movimentação', () => {
    for (const m of data.movements) {
      if (m.type === 'SAIDA') expect(m.quantity).toBeLessThan(0);
      if (m.type === 'ENTRADA' || m.type === 'ESTORNO') {
        expect(m.quantity).toBeGreaterThan(0);
      }
      expect(m.quantity).not.toBe(0);
    }
  });

  it('vendas: em ordem cronológica, com total igual à soma dos subtotais', () => {
    data.sales.forEach((sale, index) => {
      expect(sale.ref).toBe(index + 1);
      if (index > 0) {
        expect(sale.at.getTime()).toBeGreaterThanOrEqual(
          data.sales[index - 1].at.getTime(),
        );
      }
      expect(sale.items.length).toBeGreaterThan(0);
      expect(new Set(sale.items.map((i) => i.sku)).size).toBe(
        sale.items.length,
      );
      for (const item of sale.items) {
        expect(item.subtotalCents).toBe(item.unitPriceCents * item.quantity);
      }
      expect(sale.totalCents).toBe(
        sale.items.reduce((sum, i) => sum + i.subtotalCents, 0),
      );
    });
  });

  it('cada item vendido tem a sua SAIDA, e cada cancelamento o seu ESTORNO', () => {
    for (const sale of data.sales) {
      const linked = data.movements.filter((m) => m.saleRef === sale.ref);
      const exits = linked.filter((m) => m.type === 'SAIDA');
      const refunds = linked.filter((m) => m.type === 'ESTORNO');

      expect(exits.map((m) => [m.sku, -m.quantity, m.at.getTime()])).toEqual(
        sale.items.map((i) => [i.sku, i.quantity, sale.at.getTime()]),
      );
      if (sale.cancel) {
        expect(sale.cancel.at.getTime()).toBeGreaterThan(sale.at.getTime());
        expect(refunds.map((m) => [m.sku, m.quantity])).toEqual(
          sale.items.map((i) => [i.sku, i.quantity]),
        );
        expect(refunds.every((m) => m.reason === sale.cancel?.reason)).toBe(
          true,
        );
      } else {
        expect(refunds).toHaveLength(0);
      }
    }
  });

  it('produto inativo não tem movimentação', () => {
    const inactive = data.products.filter((p) => !p.active);
    expect(inactive.length).toBeGreaterThan(0);
    for (const product of inactive) {
      expect(data.movements.some((m) => m.sku === product.sku)).toBe(false);
    }
  });

  it('a história tem o que a demo precisa mostrar', () => {
    const daysWithSales = new Set(
      data.sales.map((s) =>
        Math.floor((s.at.getTime() - 3 * 3600_000) / 86_400_000),
      ),
    );
    expect(daysWithSales.size).toBeGreaterThanOrEqual(DEMO_DAYS - 1);
    expect(data.sales.filter((s) => s.cancel).length).toBeGreaterThan(0);
    expect(data.movements.some((m) => m.type === 'AJUSTE')).toBe(true);
    expect(
      data.products.filter((p) => p.active && p.currentStock <= p.minStock)
        .length,
    ).toBeGreaterThan(0);
  });

  it('uma conta demo por papel, e uma conta comum para o visitante editar', () => {
    const demo = data.users.filter((u) => u.isDemo);
    expect(demo.map((u) => u.role).sort()).toEqual([
      'ADMIN',
      'GERENTE',
      'VENDEDOR',
    ]);
    expect(demo.map((u) => u.email).sort()).toEqual(
      Object.values(DEMO_ACCOUNTS).sort(),
    );
    expect(data.users.some((u) => !u.isDemo)).toBe(true);
  });
});

describe('centsToDecimal', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [999, '9.99'],
    [123456, '1234.56'],
    [-150, '-1.50'],
  ])('%i centavos -> "%s"', (cents, expected) => {
    expect(centsToDecimal(cents)).toBe(expected);
  });
});
