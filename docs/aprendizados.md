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

## Fase 1, parte A: autenticação

### Conceitos usados

- **Access token + refresh token.** O access token (JWT, 15 min) vai no cabeçalho `Authorization` de cada requisição. O refresh token (aleatório, 7 dias) só serve para pedir um access token novo. Se o access token vazar, o estrago dura no máximo 15 minutos.
- **Cookie `httpOnly` + `SameSite=Strict`.** O refresh token fica num cookie que o JavaScript da página não consegue ler (protege contra XSS) e que o navegador não envia a partir de outro site (protege contra CSRF). O `Path=/api/v1/auth` faz o cookie viajar só para as rotas de autenticação.
- **Rotação com detecção de reuso.** Cada refresh troca o token por um novo e marca o antigo como substituído. Todos os tokens de um login formam uma "família". Se um token já trocado reaparecer depois de 10 s, alguém tem uma cópia dele: a família inteira é revogada.
- **`tokenVersion`.** Um JWT não pode ser "cancelado" antes de expirar. Para invalidar na hora, o token carrega a versão do usuário (`ver`) e o guard compara com o banco. Trocar a senha incrementa a versão, e todos os tokens antigos deixam de valer.
- **Hash diferente para senha e para token.** Senha: argon2id, lento de propósito, porque senhas são curtas e previsíveis. Refresh token: SHA-256, rápido, porque o token tem 256 bits aleatórios (não existe dicionário) e precisamos buscá-lo pelo hash.
- **Anti-enumeração de usuários.** E-mail inexistente, senha errada e usuário inativo devolvem a mesma mensagem, e o e-mail inexistente ainda roda um argon2 contra um hash falso, para o tempo de resposta não denunciar quais e-mails têm conta.
- **Regras no banco.** `CHECK` de e-mail minúsculo e trigger que bloqueia `UPDATE`/`DELETE` na auditoria. Valem mesmo que algum código futuro esqueça de validar.
- **Migrations no entrypoint.** O container roda `prisma migrate deploy` antes de iniciar a API. O `deploy` só aplica migrations versionadas; nunca gera nem apaga nada.

### O bug de concorrência que o teste pegou

Cinco renovações simultâneas com o mesmo refresh token deveriam dar 1 sucesso e 4 respostas 409 ("outra aba renovou, tente de novo"). O teste mostrou 1 sucesso e 4 sessões **encerradas por suspeita de roubo**, em 19 de 20 tentativas.

O que acontecia, no isolamento padrão do Postgres (READ COMMITTED):

1. As 5 requisições leem o token ao mesmo tempo: todas veem `revoked_at = NULL`.
2. A primeira faz `UPDATE ... WHERE revoked_at IS NULL` e confirma.
3. As outras estavam esperando o lock da linha; o Postgres reavalia o `WHERE` e o `UPDATE` afeta 0 linhas. Até aqui, certo.
4. O bug: o código decidia "corrida ou roubo?" olhando a cópia lida no passo 1, que dizia "nunca foi substituído". Resultado: roubo.

Correção: depois que o `UPDATE` falha, ler o token de novo. Em READ COMMITTED, cada comando novo enxerga o que já foi confirmado. O teste de regressão repete o cenário 5 vezes e foi conferido nos dois sentidos: falha com o bug e passa com a correção.

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Refresh token em cookie `httpOnly` | XSS não consegue ler o token | Corpo da resposta + `localStorage`: qualquer script injetado leria |
| Papel e status lidos do banco a cada requisição | Desativar ou trocar papel vale na hora | Papel dentro do JWT: só mudaria quando o token expirasse |
| `@nestjs/jwt` + guard próprio | Pouco código, fácil de explicar linha por linha | Passport: mais uma camada; `@nestjs/authentication`: 0.1.x e muito amplo |
| argon2id 19 MiB / t=2 / p=1 (OWASP) | Seguro e cabe no limite de 384 MB do container | Padrão da biblioteca (64 MiB): poucos logins simultâneos derrubariam a API |
| Janela de 10 s antes de tratar reuso como roubo | Duas abas renovando juntas é uso normal | Revogar sempre: derrubaria usuários legítimos |
| `AuditLog.action` como texto + união no TypeScript | As ações crescem a cada fase sem migration | Enum do Postgres: uma migration por ação nova |
| Senha errada na troca de senha responde 400 | 401 faria o front achar que a sessão expirou | 401 ou 403 |
| `prisma` como dependência de produção | O container precisa do CLI para `migrate deploy` | Serviço separado só para migrations: mais um container para manter |

### Perguntas de entrevista

1. **Como você invalida um JWT antes de ele expirar?**
   Não dá para "apagar" um JWT, porque ele é validado só pela assinatura. Coloquei no token a versão do usuário (`tokenVersion`) e o guard compara com o banco a cada requisição. Trocar a senha ou desativar o usuário incrementa a versão, e todos os tokens anteriores passam a ser recusados. O custo é uma consulta por chave primária por requisição.

2. **O que acontece se alguém roubar o refresh token?**
   Se o atacante usar o token primeiro, a vítima, ao renovar, apresenta um token já trocado. Se o atacante usar depois, é ele quem apresenta o token antigo. Nos dois casos o sistema detecta o reuso, revoga a família inteira de tokens (o atacante perde o acesso) e grava `REFRESH_TOKEN_REUSE` na auditoria. Para não confundir com duas abas renovando juntas, reusos dentro de 10 s respondem 409 sem revogar nada.

3. **Por que senha usa argon2 e o refresh token usa SHA-256?**
   Senha é curta e previsível: o hash precisa ser lento e caro em memória para tornar inviável testar milhões de palpites. O refresh token tem 256 bits aleatórios: não há palpite possível, então um hash rápido basta. E o hash do token precisa ser determinístico para eu buscar no banco por ele (`WHERE token_hash = ...`), o que o argon2, com sal aleatório, não permite.
