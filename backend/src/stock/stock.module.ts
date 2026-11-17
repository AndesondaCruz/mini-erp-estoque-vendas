import { Module } from '@nestjs/common';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

@Module({
  controllers: [StockController],
  providers: [StockService],
  // Exportado para as vendas (Fase 4) e o cancelamento (Fase 5).
  exports: [StockService],
})
export class StockModule {}
