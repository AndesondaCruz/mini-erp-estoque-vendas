-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('ENTRADA', 'SAIDA', 'AJUSTE', 'ESTORNO');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" VARCHAR(255),
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_product_id_created_at_idx" ON "stock_movements"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- CreateIndex
CREATE INDEX "stock_movements_user_id_created_at_idx" ON "stock_movements"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Escrito à mão: regras que o schema do Prisma não consegue declarar.
-- ---------------------------------------------------------------------------

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_not_zero_chk" CHECK ("quantity" <> 0);

-- O sinal combina com o tipo. AJUSTE pode ir para os dois lados.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sign_chk" CHECK (
  ("type" = 'ENTRADA' AND "quantity" > 0) OR
  ("type" = 'SAIDA'   AND "quantity" < 0) OR
  ("type" = 'ESTORNO' AND "quantity" > 0) OR
  ("type" = 'AJUSTE')
);

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_balance_after_chk" CHECK ("balance_after" >= 0);

-- Saída manual, ajuste e estorno precisam de motivo: são as movimentações
-- que alguém vai querer investigar depois. (Na Fase 4, a saída gerada por
-- uma venda passa a ser identificada pela venda.)
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reason_chk" CHECK (
  "type" = 'ENTRADA' OR length(trim(coalesce("reason", ''))) > 0
);

-- Histórico imutável, garantido pelo banco (mesmo padrão da auditoria).
-- TRUNCATE não dispara este trigger; os testes e2e usam TRUNCATE.
CREATE FUNCTION "stock_movements_block_changes"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements é somente inserção: % não é permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_movements_append_only"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "stock_movements_block_changes"();
