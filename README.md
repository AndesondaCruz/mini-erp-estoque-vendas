# Mini-ERP de estoque e vendas

> Projeto em construção. Este README descreve apenas o que já está implementado.
> O plano completo, com modelagem, permissões e fases, está em [docs/plano.md](docs/plano.md).

Sistema para pequeno comércio controlar produtos, estoque e vendas, com três papéis de usuário (ADMIN, GERENTE e VENDEDOR). O foco técnico é a consistência do estoque: duas vendas simultâneas do último item não podem deixar o saldo negativo.

## Estado atual

Fase 0 (fundação) concluída:

- API NestJS 12 em TypeScript strict, com prefixo `/api/v1`
- `GET /api/v1/health`: estado da API e da conexão com o PostgreSQL (503 se o banco cair)
- Documentação Swagger em `/api/docs`
- Variáveis de ambiente validadas na inicialização (a API não sobe com configuração inválida)
- Formato único de erro com `requestId`, logs estruturados (pino), helmet, CORS restrito e rate limiting
- Prisma 7 configurado com PostgreSQL 16
- Testes unitários e e2e (Vitest + Supertest, com banco real)
- Docker Compose com banco e API, e CI no GitHub Actions

## Stack

- Back-end: NestJS 12, TypeScript 6, Prisma 7, PostgreSQL 16
- Testes: Vitest e Supertest
- Infraestrutura: Docker Compose, GitHub Actions, Dependabot

O front-end (React, TanStack Query e Tailwind) entra a partir da Fase 7.

## Como rodar

Pré-requisitos: Docker com Compose, Node 22.12 ou superior e npm 11.

### Tudo em containers (banco + API)

```bash
docker compose up --build --wait
```

- Health: http://localhost:3000/api/v1/health
- Swagger: http://localhost:3000/api/docs

Para parar: `docker compose down` (adicione `--volumes` para apagar também os dados do banco).

### Desenvolvimento (API fora do container)

```bash
docker compose up -d --wait db   # só o PostgreSQL, na porta 5433
cd backend
cp .env.example .env
npm ci
npm run start:dev
```

### Testes e verificações

Dentro de `backend/`, com o banco do Compose rodando:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test            # unitários
npm run test:e2e    # e2e, usa o banco mini_erp_test
npm run build
```

## Decisões técnicas

As decisões e os trade-offs de cada fase estão em [docs/aprendizados.md](docs/aprendizados.md).
