import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';

// Global: auditoria é usada por quase todos os módulos de negócio.
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
