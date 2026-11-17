-- Escrito à mão: o Prisma gera colunas CITEXT, mas não cria a extensão.
-- Ela vem com o Postgres oficial e está disponível no Neon.
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "document" CHAR(14),
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_document_key" ON "suppliers"("document");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- ---------------------------------------------------------------------------
-- Escrito à mão: regras que o schema do Prisma não consegue declarar.
-- ---------------------------------------------------------------------------

-- citext não tem limite de tamanho; o limite fica aqui.
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_chk" CHECK (length(trim("name")) BETWEEN 1 AND 80);

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_name_not_blank_chk" CHECK (length(trim("name")) > 0);
-- CNPJ sem máscara: 12 posições de 0-9 ou A-Z e 2 dígitos verificadores.
-- Os dígitos verificadores são conferidos na API; o banco garante o formato.
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_document_format_chk" CHECK ("document" IS NULL OR "document" ~ '^[0-9A-Z]{12}[0-9]{2}$');
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_email_lowercase_chk" CHECK ("email" IS NULL OR "email" = lower("email"));
