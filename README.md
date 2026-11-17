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

Fase 1, parte A (autenticação) concluída:

| Rota | Descrição |
|---|---|
| `POST /api/v1/auth/login` | Access token (15 min) no corpo; refresh token (7 dias) em cookie `httpOnly`, `SameSite=Strict` |
| `POST /api/v1/auth/refresh` | Troca o refresh token por um novo (rotação com detecção de reuso) |
| `POST /api/v1/auth/logout` | Encerra a sessão atual |
| `GET /api/v1/auth/me` | Dados do usuário autenticado |
| `PATCH /api/v1/auth/me/password` | Troca a própria senha e encerra todas as sessões |

- Senhas com argon2id; login com rate limit próprio (5 tentativas por minuto por IP) e mensagem genérica de erro
- Desativar o usuário ou trocar a senha invalida os tokens já emitidos na hora
- Auditoria de login, logout, troca de senha e reuso de token, protegida no banco contra alteração e exclusão
- Migrations aplicadas automaticamente quando o container da API sobe

Fase 1, parte B (usuários e controle de acesso por papel) concluída:

| Rota | Descrição |
|---|---|
| `GET /api/v1/users` | Lista com paginação, busca por nome ou e-mail, filtros por papel e status, e ordenação |
| `GET /api/v1/users/:id` | Busca um usuário |
| `POST /api/v1/users` | Cria um usuário |
| `PATCH /api/v1/users/:id` | Edita nome, e-mail, papel ou status; desativar encerra as sessões do usuário |

- Todas as rotas de usuários são exclusivas do ADMIN
- Controle de acesso negado por padrão: uma rota sem `@Public()` ou `@Roles(...)` responde 403
- Trocar o papel de alguém vale na requisição seguinte, sem novo login
- O sistema não permite ficar sem ADMIN ativo, nem em alterações simultâneas
- Criação e edição de usuários entram na auditoria, com o estado antes e depois

Fase 2, parte A (categorias e fornecedores) concluída:

| Rota | Quem acessa | Descrição |
|---|---|---|
| `GET /api/v1/categories` | todos | Lista com paginação, busca por nome e ordenação |
| `POST /api/v1/categories`, `PATCH /api/v1/categories/:id` | ADMIN, GERENTE | Cria e renomeia; nome repetido, mesmo com outra capitalização, responde 409 |
| `DELETE /api/v1/categories/:id` | ADMIN, GERENTE | Exclui a categoria |
| `GET /api/v1/suppliers`, `GET /api/v1/suppliers/:id` | ADMIN, GERENTE | Lista com busca por nome ou CNPJ e filtro de status |
| `POST /api/v1/suppliers`, `PATCH /api/v1/suppliers/:id` | ADMIN, GERENTE | Cria e edita; `null` apaga um campo opcional e `active: true` reativa |
| `DELETE /api/v1/suppliers/:id` | ADMIN, GERENTE | Desativa o fornecedor, sem apagar |

- CNPJ no formato alfanumérico da Receita Federal (os numéricos continuam válidos), aceito com ou sem máscara e gravado normalizado
- Formato do CNPJ, nome não vazio e e-mail em minúsculas garantidos também por CHECK no banco

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

As migrations são aplicadas automaticamente. Para criar o primeiro ADMIN:

```bash
docker compose exec api node dist/seed.js
```

Login local: `admin@mini-erp.local` / `admin-local-123` (credenciais só para o ambiente local).

Para parar: `docker compose down` (adicione `--volumes` para apagar também os dados do banco).

### Desenvolvimento (API fora do container)

```bash
docker compose up -d --wait db   # só o PostgreSQL, na porta 5433
cd backend
cp .env.example .env
npm ci
npm run db:deploy                # aplica as migrations
npm run seed                     # cria o ADMIN definido em SEED_ADMIN_* no .env
npm run start:dev
```

Para gerar um `JWT_ACCESS_SECRET` próprio:
`node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`

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
