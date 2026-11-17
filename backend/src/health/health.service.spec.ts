import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  const makeService = (queryRaw: ReturnType<typeof vi.fn>) =>
    new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService);

  it('retorna ok quando o banco responde', async () => {
    const service = makeService(vi.fn().mockResolvedValue([{ '?column?': 1 }]));

    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('lança 503 quando o banco não responde', async () => {
    const service = makeService(
      vi.fn().mockRejectedValue(new Error('connection refused')),
    );

    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
