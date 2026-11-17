import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService, type HealthStatus } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Sem rate limit: o healthcheck do Docker chama esta rota a cada poucos segundos.
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'Estado da API e da conexão com o banco' })
  check(): Promise<HealthStatus> {
    return this.healthService.check();
  }
}
