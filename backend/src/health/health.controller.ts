import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { HealthService, type HealthStatus } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Pública e sem rate limit: o healthcheck do Docker e do Render chama
  // esta rota a cada poucos segundos, sem token.
  @Public()
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'Estado da API e da conexão com o banco' })
  check(): Promise<HealthStatus> {
    return this.healthService.check();
  }
}
