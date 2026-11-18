import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { toDecimal } from '../common/money/money.js';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ReportsService } from './reports.service.js';

function setup(rows: unknown[] = []) {
  const prisma = { $queryRaw: vi.fn().mockResolvedValue(rows) };
  const config = { get: vi.fn().mockReturnValue('America/Fortaleza') };
  const service = new ReportsService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, prisma };
}

describe('ReportsService.sales', () => {
  it('período inválido: 400 antes de consultar o banco', async () => {
    const { service, prisma } = setup();
    await expect(
      service.sales({ from: '2026-11-30', to: '2026-11-01', groupBy: 'day' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('o fuso da configuração vai como parâmetro da consulta', async () => {
    const { service, prisma } = setup();
    await service.sales({
      from: '2026-11-01',
      to: '2026-11-02',
      groupBy: 'day',
    });
    const [, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(values).toContain('America/Fortaleza');
  });

  it('totais e ticket médio com Decimal (sem erro de ponto flutuante)', async () => {
    const { service } = setup([
      { period: '2026-11-01', sales: 2, revenue: toDecimal('0.10') },
      { period: '2026-11-02', sales: 1, revenue: toDecimal('0.20') },
    ]);
    const report = await service.sales({
      from: '2026-11-01',
      to: '2026-11-02',
      groupBy: 'day',
    });
    expect(report.totalRevenue).toBe('0.30');
    expect(report.averageTicket).toBe('0.10');
  });
});
