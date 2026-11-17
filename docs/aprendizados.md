# Aprendizados

Registro do que foi usado em cada fase, por quê, o que foi descartado e como explicar numa entrevista.

## Fase 0: fundação

### Conceitos usados

- **Validação de ambiente na inicialização (fail fast).** As variáveis passam por um schema zod em `src/config/env.ts`. Se faltar `DATABASE_URL` ou o CORS vier como `*`, a API nem sobe. Exemplo: `CORS_ORIGINS= npm run start:prod` encerra com "Variáveis de ambiente inválidas" e a lista do que está errado.
- **Configuração global compartilhada (`setupApp`).** Helmet, CORS, prefixo, `ValidationPipe` e filtro de erros ficam numa única função usada por `main.ts` e pelos testes e2e. O teste exercita a mesma API que roda em produção.
- **Filtro global de exceções.** Toda resposta de erro tem o mesmo formato (`statusCode`, `error`, `message`, `details`, `path`, `timestamp`, `requestId`). Erros inesperados viram 500 com mensagem genérica: a causa real vai só para o log.
- **Request ID.** Cada requisição recebe um `x-request-id` (ou reaproveita o do cliente, se tiver formato seguro). O mesmo id aparece no log e no corpo do erro, o que liga a reclamação de um usuário à linha exata do log.
- **Logs estruturados (pino).** Em produção, cada linha é um JSON filtrável por campo. O cabeçalho `Authorization` é mascarado e o healthcheck não gera log.
- **Driver adapter do Prisma 7.** O client não traz mais um motor binário; conversa com o banco pelo driver `pg` via `@prisma/adapter-pg`.
- **Docker multi-stage e usuário não root.** A imagem final leva só `dist/` e dependências de produção, e roda como o usuário `node`.
- **Healthcheck com dependência.** No Compose, a API só sobe quando o banco está saudável (`depends_on: condition: service_healthy`) e reinicia no máximo 5 vezes (`on-failure:5`).
- **Cadeia de suprimentos no npm.** O npm 11 só executa scripts de instalação aprovados no campo `allowScripts`. Aprovamos os do Prisma (necessários) e negamos o `@scarf/scarf` (telemetria do Swagger UI).

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Prisma fixado em 7.10.1 exato | O `latest` do npm apontava para um RC do Prisma 8, incompatível com o `@prisma/client` estável | Usar `^7` ou `latest`: um erro de publicação de terceiros quebraria o build |
| Opções explícitas no generator (`moduleFormat`, `importFileExtension`) | Sem elas, o Prisma deduz a extensão dos imports lendo o `tsconfig.json`. No Docker o generate roda antes do tsconfig existir e gerava imports `.ts`, que derrubavam a API | Copiar o tsconfig para a etapa de dependências: funciona, mas deixa o resultado dependente de um detalhe do Dockerfile |
| `request.originalUrl` no filtro de erros | No Express, `request.url` vem relativo ao roteador e perdia o `/api/v1`. O teste e2e pegou o bug | Montar o caminho manualmente com o prefixo |
| Health próprio em vez de `@nestjs/terminus` | Uma checagem simples (`SELECT 1`) com 503 cobre o necessário e é fácil de explicar | Terminus: mais recursos, mais uma dependência sem uso agora |
| zod para validar o ambiente | Tipagem inferida do schema (`Env`) e mensagens claras | class-validator: exigiria uma classe só para o `.env` |
| Banco de teste separado (`mini_erp_test`) | Testes e2e podem apagar dados sem tocar no banco de desenvolvimento | Usar o mesmo banco: um teste apagaria seus dados locais |
| Porta 5433 no host | Evita conflito com outro Postgres local na 5432 | 5432: falharia com o banco de outro projeto rodando |
| Vitest (padrão do Nest 12) | O CLI já gera o projeto ESM com Vitest; o Jest exige configuração extra para ESM | Forçar o Jest, como no plano original |

### Perguntas de entrevista

1. **Por que validar as variáveis de ambiente no boot, e não quando forem usadas?**
   Porque o erro aparece no deploy, não no meio do expediente. Uma `DATABASE_URL` errada descoberta só na primeira venda vira incidente; descoberta no boot, o deploy falha e a versão anterior continua no ar.

2. **Como você investiga um erro que um usuário relatou?**
   Peço o `requestId` que veio no corpo do erro (ou no cabeçalho `x-request-id`) e filtro o log por ele. Como o log é JSON, encontro a requisição, a rota e o stack trace, sem expor detalhes internos ao usuário.

3. **Por que a imagem Docker roda como usuário `node` e em várias etapas?**
   Rodar como root dá ao invasor, se ele explorar uma falha da aplicação, poder de root dentro do container. As várias etapas deixam fora da imagem final o compilador, os testes e as dependências de desenvolvimento: menos tamanho e menos superfície de ataque.
