-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('CONCLUIDA', 'CANCELADA');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "sale_id" UUID;

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "seller_id" UUID NOT NULL,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "SaleStatus" NOT NULL DEFAULT 'CONCLUIDA',
    "idempotency_key" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceled_at" TIMESTAMPTZ(3),
    "canceled_by_id" UUID,
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_number_key" ON "sales"("number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_idempotency_key_key" ON "sales"("idempotency_key");

-- CreateIndex
CREATE INDEX "sales_created_at_idx" ON "sales"("created_at");

-- CreateIndex
CREATE INDEX "sales_seller_id_created_at_idx" ON "sales"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_status_created_at_idx" ON "sales"("status", "created_at");

-- CreateIndex
CREATE INDEX "sale_items_product_id_idx" ON "sale_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_sale_id_product_id_key" ON "sale_items"("sale_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_movements_sale_id_idx" ON "stock_movements"("sale_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_canceled_by_id_fkey" FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Escrito à mão: regras que o schema do Prisma não consegue declarar.
-- ---------------------------------------------------------------------------

ALTER TABLE "sales" ADD CONSTRAINT "sales_total_chk" CHECK ("total" >= 0);

-- Os três campos de cancelamento existem juntos, e só em venda cancelada.
ALTER TABLE "sales" ADD CONSTRAINT "sales_cancel_fields_chk" CHECK (
  ("status" = 'CONCLUIDA' AND "canceled_at" IS NULL AND "canceled_by_id" IS NULL AND "cancel_reason" IS NULL)
  OR
  ("status" = 'CANCELADA' AND "canceled_at" IS NOT NULL AND "canceled_by_id" IS NOT NULL
     AND length(trim(coalesce("cancel_reason", ''))) > 0)
);

ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_quantity_chk" CHECK ("quantity" > 0);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_prices_chk" CHECK ("unit_price" >= 0 AND "unit_cost" >= 0);
-- O subtotal gravado tem de bater com quantidade x preço unitário.
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_subtotal_chk" CHECK ("subtotal" = "quantity" * "unit_price");

-- Motivo: a saída gerada por venda é identificada pela própria venda.
-- (Substitui a regra da Fase 3, que exigia motivo em toda SAIDA.)
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_reason_chk";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reason_chk" CHECK (
  "type" = 'ENTRADA'
  OR ("type" = 'SAIDA' AND "sale_id" IS NOT NULL)
  OR length(trim(coalesce("reason", ''))) > 0
);

-- Só saída (venda) e estorno (cancelamento) apontam para uma venda.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sale_type_chk" CHECK (
  "sale_id" IS NULL OR "type" IN ('SAIDA', 'ESTORNO')
);
