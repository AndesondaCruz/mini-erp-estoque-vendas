import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

// Global: auditoria é usada por quase todos os módulos de negócio
// (e pelo RolesGuard, que grava os acessos negados).
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
