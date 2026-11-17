-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "category_id" UUID NOT NULL,
    "supplier_id" UUID,
    "cost_price" DECIMAL(12,2) NOT NULL,
    "sale_price" DECIMAL(12,2) NOT NULL,
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "current_stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_supplier_id_idx" ON "products"("supplier_id");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Escrito à mão: regras que o schema do Prisma não consegue declarar.
-- ---------------------------------------------------------------------------

-- Última barreira contra saldo negativo: vale mesmo que algum código futuro
-- esqueça a condição "current_stock >= quantidade" na baixa (risco 1 do plano).
ALTER TABLE "products" ADD CONSTRAINT "products_current_stock_chk" CHECK ("current_stock" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_min_stock_chk" CHECK ("min_stock" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_cost_price_chk" CHECK ("cost_price" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_sale_price_chk" CHECK ("sale_price" >= 0);

ALTER TABLE "products" ADD CONSTRAINT "products_name_not_blank_chk" CHECK (length(trim("name")) > 0);
-- SKU em maiúsculas, com letras, números, hífen e ponto: assim o UNIQUE
-- não aceita "cer-350" e "CER-350" como produtos diferentes.
ALTER TABLE "products" ADD CONSTRAINT "products_sku_format_chk" CHECK ("sku" ~ '^[A-Z0-9][A-Z0-9.-]{0,39}$');
