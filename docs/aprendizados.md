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

## Fase 1, parte B: usuários e RBAC

### Conceitos usados

- **Negar por padrão (deny-by-default).** O `RolesGuard` é global: toda rota passa por ele. Uma rota só abre se declarar `@Public()` ou `@Roles(...)` com pelo menos um papel. Esquecer o decorator gera 403 e um aviso no log, e não uma rota aberta por engano. Exemplo: um `@Get('relatorio')` novo sem decorator responde 403 até alguém decidir quem pode acessá-lo.
- **Ordem dos guards globais.** O `JwtAuthGuard` roda primeiro e descobre quem é o usuário (preenche `request.user`). O `RolesGuard` roda depois e decide se ele pode acessar a rota. Os dois são registrados com `APP_GUARD` no `AuthModule`, nessa ordem.
- **Método sobrescreve classe.** O `UsersController` declara `@Roles('ADMIN')` na classe. O `getAllAndOverride` procura primeiro no método e depois na classe, então um `@Roles` num método específico teria prioridade sobre o da classe.
- **Papel lido do banco a cada requisição.** Trocar o papel de alguém vale na requisição seguinte, sem novo login. O teste e2e "trocar o papel vale na próxima requisição" promove um GERENTE a ADMIN e usa o **mesmo** token antigo para acessar `/users`.
- **Paginação obrigatória e limitada.** `page` e `pageSize` têm valores padrão (1 e 20), e o `pageSize` tem máximo de 100. O cliente não consegue pedir a tabela inteira. A ordenação sempre desempata por `id`: sem isso, dois usuários com o mesmo nome poderiam trocar de página entre uma requisição e outra.
- **Ordenação por lista de campos permitidos.** O `sort` só aceita `name`, `email`, `role` ou `createdAt` (`@IsIn(USER_SORT_FIELDS)`). O valor da URL nunca vira nome de coluna diretamente. Exemplo: `?sort=passwordHash` responde 400.
- **Proteção contra mass assignment.** O `update` grava campo a campo (`name`, `email`, `role`, `active`), e não com `...dto`. Mesmo que um campo extra escapasse da validação, ele não chegaria ao banco. O `UpdateUserDto` também deixa a senha de fora: cada usuário troca a própria em `PATCH /auth/me/password`.
- **Desativar encerra as sessões na hora.** Desativar incrementa o `tokenVersion` (invalida os access tokens) e revoga os refresh tokens. Sem o incremento, um usuário desativado e reativado em menos de 15 minutos voltaria a usar o token antigo.
- **E-mail duplicado vira 409.** A unicidade é garantida pelo `UNIQUE` do banco, não por um "consulta antes de inserir". O erro `P2002` do Prisma é traduzido para 409. Consultar antes teria a mesma corrida de sempre: dois cadastros simultâneos passariam pela consulta.
- **Auditoria com antes e depois.** `USER_CREATED` e `USER_UPDATED` gravam o estado em `before`/`after`, sempre pelo `toPublicUser` (nunca com o hash da senha), dentro da mesma transação da alteração.

### A regra do último ADMIN

Regras: um ADMIN não pode rebaixar nem desativar a si mesmo (403), e o sistema precisa manter pelo menos um ADMIN ativo (409).

Com a primeira regra, o último ADMIN só pode sumir por concorrência: o ADMIN A rebaixa B enquanto B rebaixa A, no mesmo instante. Sem lock, no isolamento padrão do Postgres (READ COMMITTED):

1. As duas transações contam os ADMINs ativos: as duas veem 2.
2. As duas concluem "sobra 1, pode rebaixar" e gravam.
3. Resultado: nenhum ADMIN ativo. Ninguém mais consegue gerenciar usuários.

Correção: quando a alteração mexe em papel ou status, a transação começa com `SELECT id FROM users WHERE role = 'ADMIN' AND active = true FOR UPDATE`. Esse comando trava as linhas dos ADMINs ativos. A segunda transação fica esperando até a primeira confirmar. Quando consegue o lock, o Postgres reavalia o `WHERE` com os dados já confirmados: o ADMIN rebaixado não aparece mais na lista, sobra só o alvo, e a regra devolve 409.

O lock vem **antes** da leitura do usuário pelo mesmo motivo do bug do refresh token (parte A): em READ COMMITTED, cada comando enxerga o que estava confirmado quando ele começou. Uma leitura feita antes do lock poderia estar desatualizada.

O teste e2e repete a corrida 5 vezes. A requisição que perde pode receber dois códigos, e os dois estão corretos:

- **403**, se ela chegou ao `RolesGuard` depois que a vencedora confirmou (o papel é lido do banco, e ela já não é ADMIN);
- **409**, se passou pelo guard antes e ficou esperando o lock.

A garantia verificada é a que importa: no fim de cada rodada, existe exatamente 1 ADMIN ativo.

Trocar só o nome ou o e-mail não faz o lock. Essas alterações não afetam a regra, e travar todos os ADMINs em cada edição criaria espera à toa.

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Negar por padrão no `RolesGuard` | Esquecer um decorator bloqueia em vez de expor dados | Permitir por padrão: uma rota nova sem `@Roles` ficaria aberta para qualquer usuário logado |
| `SELECT ... FOR UPDATE` (lock pessimista) | A disputa é rara e curta; esperar alguns milissegundos é mais simples do que repetir a transação | Isolamento `SERIALIZABLE`: o Postgres aborta uma das transações, e o código precisaria repetir em caso de erro de serialização |
| Lock só quando a alteração mexe em papel ou status | Editar nome não afeta a regra e não deve esperar | Travar sempre: espera desnecessária em toda edição |
| 403 para "alterar a si mesmo" e 409 para "último ADMIN" | O primeiro é proibido por quem você é; o segundo é um conflito com o estado atual dos dados | Usar 400 nos dois casos: o front não saberia diferenciar |
| `PasswordService` fornecido pelo `UsersModule` | O `AuthModule` já importa o `UsersModule`; o caminho inverso criaria dependência circular | `forwardRef` nos dois módulos: funciona, mas esconde um acoplamento que dá para evitar |
| `revokeAllUserSessions` como função solta em `auth/sessions.ts` | Os dois módulos usam a mesma regra, recebendo a transação como parâmetro | Injetar o `RefreshTokenService` no `UsersService`: de novo, dependência circular |
| Unicidade do e-mail pelo `UNIQUE` do banco + 409 | Só o banco garante unicidade em concorrência | Consultar antes de inserir: dois cadastros simultâneos passariam |
| `PATCH` sem senha | Senha é responsabilidade do próprio usuário, com confirmação da senha atual | Admin definir a senha de outro: o admin passaria a conhecer a senha |
| Paginação por `page`/`pageSize` (offset) | Simples de explicar e suficiente para a quantidade de usuários de uma loja | Paginação por cursor: melhor para tabelas grandes, mas mais complexa para o front |

### Perguntas de entrevista

1. **Como você garante que o sistema nunca fica sem administrador?**
   Duas regras: ninguém altera o próprio papel nem se desativa (403), e a alteração que tiraria o último ADMIN ativo é recusada (409). A segunda só é segura com lock: a transação trava as linhas dos ADMINs ativos com `SELECT ... FOR UPDATE` antes de decidir. Assim, duas alterações simultâneas não conseguem contar "2 ADMINs" ao mesmo tempo. Um teste e2e dispara as duas requisições juntas e verifica que sempre sobra exatamente um.

2. **O que acontece se alguém criar uma rota nova e esquecer de configurar as permissões?**
   Ela fica bloqueada. O `RolesGuard` é global e nega por padrão: sem `@Public()` ou `@Roles(...)`, responde 403 e registra um aviso no log com o nome do controller e do método. O erro aparece no desenvolvimento, e não como um vazamento em produção.

3. **Por que o `sort` da listagem é validado contra uma lista, se o Prisma já usa consultas parametrizadas?**
   Parâmetros protegem valores, não nomes de coluna. Aceitar qualquer campo deixaria o cliente ordenar por colunas internas (`passwordHash`, `tokenVersion`) e, por exemplo, deduzir informações pela ordem dos resultados, ou forçar ordenações sem índice. Com a lista, só passam os campos pensados para isso, e o resto responde 400 antes de chegar ao banco.

## Fase 2, parte A: categorias e fornecedores

### Conceitos usados

- **`citext` (texto sem diferenciar maiúsculas).** A coluna `categories.name` compara "Bebidas" e "bebidas" como iguais, então o `UNIQUE` recusa a segunda. O valor é gravado como foi digitado. A extensão é criada na migration (`CREATE EXTENSION IF NOT EXISTS citext`), porque o Prisma gera a coluna, mas não a extensão.
- **O banco garante, a API traduz.** Três regras desta fase moram no banco: nome de categoria único, CNPJ único e "categoria com produtos não pode ser excluída" (chave estrangeira `RESTRICT`, que entra no PR de produtos). O helper `isPrismaError` reconhece os códigos do Prisma, e cada service converte: P2002 e P2003 viram 409; P2025 vira 404. Qualquer outro erro passa adiante e vira 500 no filtro global.
- **CNPJ alfanumérico.** A Receita Federal passou a adotar, a partir de 2026, CNPJs com letras nas 12 primeiras posições; os 2 dígitos verificadores continuam numéricos. O cálculo é o módulo 11 de sempre, mas cada caractere vale o código ASCII menos 48 (`'7'` vale 7, `'A'` vale 17). Os CNPJs só com números são um caso particular e continuam válidos.
- **Normalizar na entrada.** O CNPJ chega com ou sem máscara e em qualquer capitalização; um `@Transform` remove `.`, `/`, `-` e espaços e passa para maiúsculas antes da validação. Assim `11.222.333/0001-81` e `11222333000181` são o mesmo valor, e o `UNIQUE` funciona. A busca usa a mesma normalização: digitar "11.222.333" encontra o fornecedor.
- **Validação em duas camadas.** A API confere os dígitos verificadores (mensagem clara, 400). O banco confere o formato com um CHECK (`^[0-9A-Z]{12}[0-9]{2}$`). Um teste e2e insere direto no banco, sem passar pela API, para provar que o CHECK funciona sozinho.
- **`null` contra campo ausente no PATCH.** Em fornecedores, `{"phone": null}` apaga o telefone, e um corpo sem `phone` mantém o valor. O service grava campo a campo, e o Prisma trata `undefined` como "não alterar" e `null` como "gravar NULL".
- **Exclusão física contra desativação.** Categoria não tem histórico próprio: `DELETE` apaga. Fornecedor vai ser referenciado por produtos: `DELETE` só desativa (`active = false`), e `PATCH {"active": true}` reativa.
- **Teste unitário com banco falso.** O service roda de verdade, mas cada método do Prisma é um `vi.fn()` que o teste controla (`mockRejectedValue`) e inspeciona (`toHaveBeenCalledWith`). Os testes seguem Arrange, Act, Assert.

### Teste conferido nos dois sentidos

Um teste que nunca falhou não prova nada. O teste "categoria com produtos (P2003): 409" foi conferido trocando, de propósito, o código do erro no service: o teste falhou (e só ele). Com o service restaurado, voltou a passar.

O CNPJ foi testado com o exemplo publicado pela Receita (`12ABC34501DE35`), e não com um valor calculado pelo próprio código. Se o algoritmo estivesse errado, um valor calculado por ele passaria no teste mesmo assim.

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| `citext` no nome da categoria | O Prisma conhece o tipo (`@db.Citext`), e o `@unique` continua visível no schema | Índice único em `lower(name)` escrito à mão: o Prisma não conhece índices sobre expressões e poderia tentar removê-lo numa migration futura |
| Aceitar CNPJ alfanumérico | CNPJs novos têm letras; validar "só 14 dígitos" recusaria empresas reais | Formato antigo: funcionaria hoje e quebraria com o primeiro fornecedor novo |
| CNPJ normalizado antes de gravar | Um único formato no banco faz o `UNIQUE` e a busca funcionarem | Gravar como digitado: `11.222.333/0001-81` e `11222333000181` virariam fornecedores diferentes |
| Exclusão de categoria decidida pela chave estrangeira | Não há janela entre "conferir" e "apagar" | Contar produtos antes: outro usuário poderia cadastrar um produto no meio |
| `DELETE` de fornecedor desativa | Produtos e relatórios vão apontar para ele | Apagar: quebraria o histórico, ou seria bloqueado pela chave estrangeira |
| `isPrismaError` compartilhado em `common/prisma` | A tradução de erros se repete em todos os services | Copiar a verificação em cada service. O `UsersService` ainda tem a versão antiga e pode migrar depois |
| Sem auditoria para categorias e fornecedores | O plano (seção 3.2) audita ações sensíveis: preço, estoque, vendas, usuários | Auditar tudo: mais escrita no banco sem valor de investigação |

### Perguntas de entrevista

1. **Como você garante que não existam duas categorias "Bebidas" e "bebidas"?**
   Com a coluna em `citext` e um `UNIQUE`: o Postgres compara sem diferenciar maiúsculas, e a segunda inserção falha com violação de unicidade, que a API traduz para 409. Conferir antes no código não bastaria, porque dois cadastros simultâneos passariam pela consulta.

2. **O que muda num sistema com o CNPJ alfanumérico?**
   A validação: as 12 primeiras posições aceitam letras, e o cálculo dos dígitos usa o código ASCII menos 48 de cada caractere. Também o armazenamento: o campo precisa ser texto (`CHAR(14)`), e nunca número. Máscaras, buscas e regex do tipo `\d{14}` precisam ser revistas.

3. **Por que um erro desconhecido do banco não vira 404 ou 409?**
   Porque a mensagem seria falsa ("não encontrado", "já existe") e o erro real sumiria. O service só traduz os códigos que entende; o resto chega ao filtro global, que responde 500 com mensagem genérica e grava a causa no log com o `requestId`.

## Fase 2, parte B: produtos

### Conceitos usados

- **Dinheiro como texto decimal.** O JSON leva `"12.50"`, e não `12.5`. Em JavaScript, `0.1 + 0.2` dá `0.30000000000000004`; uma string vai direto para o `Decimal` do Prisma e para a coluna `DECIMAL(12,2)` sem passar por ponto flutuante. A regex `^\d{1,10}(\.\d{1,2})?$` recusa número, vírgula, sinal negativo e mais de 2 casas. A resposta sai sempre com 2 casas (`"5.50"`).
- **Resposta por papel.** O `toProductDto` recebe o papel e só inclui `costPrice` para ADMIN e GERENTE. Para o VENDEDOR a chave não existe no objeto (nem `null`, nem `undefined`), então não aparece no JSON. Esconder só no front não adiantaria: qualquer um leria o campo chamando a API.
- **Campo somente leitura pela API.** `currentStock` não está no DTO. Como a validação global usa `forbidNonWhitelisted`, enviá-lo responde 400. O saldo só vai mudar pelo `StockService` da Fase 3, sempre junto com uma movimentação (risco 3 do plano).
- **Comparar duas colunas no banco.** O filtro `lowStock` usa `currentStock: { lte: prisma.product.fields.minStock }`, que vira `current_stock <= min_stock` no SQL. Cada produto tem o próprio mínimo, então não dá para comparar com um número fixo.
- **Lock para proteger o histórico.** A edição trava a linha do produto (`SELECT ... FOR UPDATE`) antes de ler o estado atual. O preço final estaria certo mesmo sem lock (vence o último), mas a auditoria não: veja a seção seguinte.
- **Auditoria só quando algo muda.** `PRODUCT_PRICE_CHANGED` compara os `Decimal` com `.equals()`, então mandar `"5.5"` para um preço de `5.50` não gera registro. Desativar um produto já inativo também não.
- **O mesmo código de erro, dois significados.** P2003 no `DELETE` de categoria quer dizer "ainda há produtos apontando para ela" (409, conflito com o estado atual). No `INSERT` de produto quer dizer "a categoria informada não existe" (400, dado inválido). Cada service traduz pelo contexto da operação.

### O histórico com buracos que o lock evita

Preço em 10. Dois gerentes alteram ao mesmo tempo: A para 12, B para 15. Sem lock, em READ COMMITTED:

1. A e B leem o produto: os dois veem 10.
2. A grava 12 e audita "de 10 para 12".
3. B grava 15 e audita "de 10 para 15".

O preço final (15) está certo, mas o histórico diz que ele nunca foi 12. Numa investigação ("quem mudou o preço para 12?"), a resposta some.

Com `SELECT ... FOR UPDATE` antes da leitura, B espera A confirmar e lê 12: a auditoria fica "10 para 12" e "12 para 15".

O teste e2e dispara 5 alterações simultâneas e confere que os registros formam uma cadeia: começando em 10, cada "depois" é o "antes" de outro registro, até chegar ao preço final. Conferido nos dois sentidos: sem o `FOR UPDATE`, o teste falhou nas 3 execuções; com ele, passou nas 3.

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Dinheiro como string decimal | Nunca passa por `number`; legível no Swagger | Número decimal: erro de ponto flutuante. Centavos inteiros: seguro, mas obriga o front a converter tudo |
| `costPrice` omitido por papel no service | Vale para qualquer cliente da API | Esconder no front: o campo continuaria na resposta |
| Fornecedor opcional no produto | Muita compra de pequeno comércio é no atacarejo, sem cadastro | Obrigatório: forçaria fornecedores falsos como "Diversos", que sujam relatórios |
| Fornecedor inativo não pode ser vinculado | Um fornecedor desativado não deveria receber produtos novos | Aceitar: o cadastro ficaria incoerente |
| Lock da linha em toda edição de produto | Uma linha só, lock curto; protege a auditoria de preço e de status | Lock só quando o preço muda: mais código para pouco ganho |
| Reativar só pelo ADMIN, via `PATCH` | Mesmo papel que desativa; sem rota extra | Rota `POST /products/:id/activate`: mais uma rota para o mesmo efeito |
| VENDEDOR vê só produtos ativos, mesmo pedindo `active=false` | Ele só precisa do que pode vender | Responder 403 ao filtro: mais atrito sem ganho de segurança |
| `PRODUCT_CREATED` e `PRODUCT_REACTIVATED` na auditoria (além do plano) | A cadeia de preços tem ponto de partida, e o ciclo desativar/reativar fica completo | Auditar só mudança de preço e desativação, como no plano |
| Índice B-tree em `name` | Ajuda ordenação e busca por prefixo | Índice trigram (`pg_trgm`) para `ILIKE '%texto%'`: só vale a pena com milhares de produtos |

### Perguntas de entrevista

1. **Por que o preço vai como string no JSON?**
   Porque `number` em JavaScript é ponto flutuante binário: `0.1 + 0.2` não dá `0.3`. Em dinheiro, esse erro aparece em totais e relatórios. A string vai direto para um tipo decimal (no Prisma, `Decimal`; no Postgres, `DECIMAL(12,2)`), que representa centavos exatamente. A validação por regex garante no máximo 2 casas antes de chegar ao banco.

2. **Como o vendedor fica sem ver o preço de custo?**
   No servidor: o service monta a resposta de acordo com o papel e simplesmente não inclui a chave `costPrice` para o VENDEDOR. Um teste e2e confere que a chave não existe, na lista e no detalhe. Esconder só no front não serve, porque qualquer um pode chamar a API direto.

3. **Se o preço final fica certo sem lock, por que travar a linha?**
   Por causa da auditoria. Sem lock, duas alterações simultâneas leem o mesmo preço "antes", e o histórico perde a alteração intermediária. O lock faz a segunda edição esperar e ler o valor já atualizado. Concorrência não é só "não perder dados": também é "não registrar uma história falsa".

## Fase 3: movimentações de estoque

### Conceitos usados

- **Um único ponto de escrita.** Só o `StockService` altera `products.current_stock`, e sempre grava a movimentação na mesma transação. É isso que mantém saldo e histórico iguais (risco 3 do plano). A API de produtos continua recusando `currentStock` (400).
- **Baixa atômica e condicional (risco 1).** A saída é um comando só: `UPDATE products SET current_stock = current_stock - q WHERE id = ... AND active AND current_stock >= q RETURNING current_stock`. A condição e a escrita acontecem juntas. Duas saídas simultâneas da última unidade: o Postgres serializa os `UPDATE` na mesma linha; a segunda espera a primeira confirmar, reavalia o `WHERE` com o saldo novo (0) e afeta 0 linhas. Nenhum lock explícito.
- **Descobrir o motivo depois, não decidir depois.** Quando o `UPDATE` afeta 0 linhas, o service lê o produto só para escolher a mensagem: 404 (não existe), 409 "produto inativo" ou 409 "estoque insuficiente" com `details.available`. A decisão de não baixar já foi tomada pelo banco.
- **Ajuste com lock (risco 4).** O gerente informa quanto contou. O service trava a linha (`SELECT ... FOR UPDATE`), calcula `delta = contado - saldo` e grava. Sem o lock, uma saída entre "ler o saldo" e "gravar o contado" seria apagada do saldo, mas continuaria no histórico. Diferença zero responde 400.
- **Por que só o ajuste trava.** A saída não precisa ler o saldo para decidir: o `WHERE` decide. O ajuste precisa ler o saldo para calcular a diferença e garantir que ele não mude até gravar.
- **Quantidade com sinal e `balanceAfter`.** Entrada é positiva e saída negativa. Assim o saldo é sempre `SUM(quantity)`, e cada linha guarda o saldo resultante (extrato legível e ponto de conferência). CHECKs garantem o sinal de cada tipo, quantidade diferente de zero e saldo resultante nunca negativo.
- **Histórico imutável.** Um trigger recusa `UPDATE` e `DELETE` em `stock_movements`, como na auditoria. Correção de erro é feita com uma nova movimentação (um AJUSTE), nunca editando a antiga.
- **Métodos que recebem a transação.** `increase`, `decrease` e `adjust` recebem o `tx` de quem chama. A venda (Fase 4) e o cancelamento (Fase 5) vão baixar e estornar estoque dentro da própria transação, reaproveitando as mesmas regras.

### As duas camadas do risco 1, vistas num teste

O teste "5 saídas simultâneas da última unidade" espera `[201, 409, 409, 409, 409]` e saldo final 0. Ele foi conferido nos dois sentidos:

- **Sem a condição `current_stock >= q`:** o teste falhou, mas o saldo **não** ficou negativo. O resultado foi `[201, 500, 500, 500, 500]`: o `CHECK (current_stock >= 0)` do banco barrou as baixas extras. Ou seja, a segunda camada (o CHECK) segurou o estrago quando a primeira (a condição) foi esquecida; só a resposta ao usuário ficou errada (erro interno em vez de "estoque insuficiente").
- **Sem o `FOR UPDATE` no ajuste:** o teste "ajuste simultâneo a uma saída" falhou nas 3 execuções. A invariante quebrou: saldo e soma das movimentações divergiram.

Com o código original, os dois passam.

### Query de reconciliação (uso operacional)

Lista os produtos cujo saldo não bate com o histórico. O resultado esperado é vazio:

```sql
SELECT p.id, p.sku, p.current_stock, COALESCE(SUM(m.quantity), 0) AS soma_movimentacoes
FROM products p
LEFT JOIN stock_movements m ON m.product_id = p.id
GROUP BY p.id, p.sku, p.current_stock
HAVING p.current_stock <> COALESCE(SUM(m.quantity), 0);
```

Um teste e2e roda essa mesma query depois de uma sequência de movimentações.

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| `UPDATE ... WHERE current_stock >= q` na saída | Condição e escrita num comando atômico; nenhum lock explícito | `SELECT ... FOR UPDATE` e depois `UPDATE`: funciona, mas são dois passos e o lock dura mais. `SERIALIZABLE`: exigiria repetir transações abortadas |
| Ajuste recebe o contado, não a diferença | O servidor calcula a diferença no momento em que trava a linha | Receber "-2": uma venda simultânea tornaria o número errado sem ninguém perceber |
| Motivo obrigatório na saída manual | É a movimentação que alguém vai investigar (avaria, perda) | Seguir o plano original (motivo só em AJUSTE e ESTORNO) |
| Um endpoint com corpo por tipo | Uma rota, como no plano; o campo errado para o tipo responde 400 | Três rotas (`/entries`, `/exits`, `/adjustments`): mais claras, mas fogem do plano |
| ENTRADA aceita produto inativo; SAIDA não | O plano proíbe só saída de inativo: a mercadoria pode chegar depois da desativação | Bloquear tudo: impediria registrar mercadoria que de fato entrou |
| Auditoria só para saída manual e ajuste | São as ações sensíveis da seção 3.2 do plano; a entrada já fica no histórico de movimentações | Auditar todas: duplicaria o histórico sem ganho |
| `saleId` só na Fase 4 | A coluna nasce com chave estrangeira para `sales` | Criar agora sem FK: uma coluna solta, sem garantia de integridade |

### Perguntas de entrevista

1. **Dois vendedores tentam tirar a última unidade ao mesmo tempo. O que acontece?**
   A baixa é um `UPDATE` condicional (`WHERE current_stock >= quantidade`). O Postgres serializa as duas atualizações na mesma linha: a primeira baixa e confirma; a segunda, ao conseguir a linha, reavalia a condição com o saldo já em 0 e não afeta nenhuma linha. A API responde 409 com o saldo disponível. Como última barreira, um `CHECK (current_stock >= 0)` no banco impede saldo negativo mesmo que algum código esqueça a condição; testei isso removendo a condição de propósito.

2. **Por que a saída não usa lock e o ajuste usa?**
   A saída não precisa ler o saldo para decidir: a condição no `WHERE` decide e grava no mesmo comando. O ajuste lê o saldo para calcular a diferença ("tinha 9, contei 7: -2") e precisa que ele não mude até gravar; por isso trava a linha com `SELECT ... FOR UPDATE`.

3. **Como você garante que o saldo nunca diverge do histórico?**
   Três coisas: um único serviço escreve no saldo, sempre na mesma transação da movimentação; o histórico é imutável (trigger); e cada movimentação guarda o saldo resultante. Um teste confere a invariante `saldo = soma das movimentações` e existe uma query de reconciliação para rodar em produção.

## Fase 4: vendas

### Conceitos usados

- **Transação "tudo ou nada".** A venda, os itens, as baixas de estoque e a auditoria são gravados numa única `$transaction`. Se o terceiro item não tem saldo, o `StockService` lança 409 e o Postgres desfaz tudo, inclusive as baixas dos dois primeiros itens. Nenhum código de "desfazer" foi escrito à mão.
- **Reaproveitar a regra da Fase 3.** A venda chama `StockService.decreaseReturningPrices(tx, ...)` para cada item, dentro da própria transação. A baixa atômica continua existindo num lugar só.
- **Ordem fixa de travamento (risco 2).** Os itens são ordenados por `productId` antes das baixas. Uma venda de [A, B] e outra de [B, A] passam a travar A antes de B: uma espera a outra, em vez de cada uma segurar um produto e esperar o outro para sempre.
- **Snapshot de preço (risco 6).** O `UPDATE` que baixa o estoque devolve `sale_price` e `cost_price` no `RETURNING`. O preço gravado no item é o que estava valendo no instante da baixa, e a linha fica travada até a venda terminar. O cliente nunca envia preço: `unitPrice` no corpo responde 400.
- **Idempotência (risco 5).** O front gera um UUID por tentativa de venda e envia no header `Idempotency-Key`. A coluna é única. Retry com a mesma chave, do mesmo vendedor e com os mesmos itens devolve a venda existente (200). Se dois envios chegam juntos, o segundo espera no índice único, recebe P2002, a transação dele é desfeita por inteiro e a API devolve a venda do primeiro.
- **IDOR (risco 8).** "Só as próprias vendas" vem do token (`actor.id`), nunca de parâmetro: um VENDEDOR que manda `?sellerId=outro` continua vendo só as dele. Pedir a venda de outra pessoa responde 404, e não 403, para não confirmar que aquele id existe.
- **Status HTTP decidido pelo service.** O controller responde 201 quando a venda foi criada e 200 quando é um retry. O service devolve `{ sale, created }`, e o controller ajusta o status com `@Res({ passthrough: true })`.

### Testes de concorrência conferidos nos dois sentidos

- **Vendas cruzadas [A, B] e [B, A], 10 rodadas:** sem a ordenação por `productId`, uma das vendas recebeu 500, e o log do Postgres registrou `ERROR: deadlock detected`. O Postgres detecta o ciclo e aborta uma das transações; a outra segue. Com a ordenação, todas as rodadas dão `[201, 201]`.
- **5 envios simultâneos com a mesma chave:** sem a recuperação do P2002, os perdedores da corrida receberam erro em vez da venda existente. Com ela: `[200, 200, 200, 200, 201]`, uma venda e uma baixa.

Também passam: 5 vendas simultâneas da última unidade (1 sucesso, 4 respostas 409) e a query de reconciliação depois de vendas simultâneas (nenhum produto com saldo diferente do histórico).

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Gravar a venda antes das baixas | O índice único da chave funciona como fila: o duplicado falha antes de travar produtos | Gravar a venda no fim: o duplicado baixaria estoque e só falharia na última etapa (o rollback corrigiria, mas com locks à toa) |
| Preço lido no `RETURNING` da baixa | Um comando confere saldo, baixa e lê o preço | `SELECT` do preço separado: abriria uma janela para o preço mudar no meio da venda |
| Ordenar itens por `productId` | Elimina o ciclo de espera que causa deadlock | Tentar de novo quando der deadlock: funciona, mas trata o sintoma |
| Recusar produto repetido em dois itens (400) | Simples e explícito; também protege o `UNIQUE (sale_id, product_id)` | Somar as quantidades em silêncio |
| `Idempotency-Key` obrigatória | Sem ela, um duplo clique cria duas vendas | Opcional: o front esqueceria em algum fluxo |
| Chave reutilizada com outro conteúdo: 409 | É erro do cliente; devolver a venda antiga esconderia o problema | Devolver a venda antiga mesmo assim |
| Número sequencial com possíveis buracos | O `SERIAL` do Postgres não volta atrás no rollback; buraco é aceitável para número de balcão | Sequência sem buracos: exigiria lock numa tabela de contador, serializando todas as vendas |
| Campos de cancelamento já criados, com CHECK | A Fase 5 só passa a usá-los; o CHECK já garante "os três juntos, só em venda cancelada" | Criar na Fase 5: mais uma migration alterando uma tabela já em uso |

### Perguntas de entrevista

1. **Como você evita deadlock numa venda com vários itens?**
   Toda venda baixa os produtos na mesma ordem (por `productId`). Deadlock precisa de um ciclo: A espera B enquanto B espera A. Com uma ordem global, quem pegou o primeiro produto sempre consegue o segundo, e a outra transação só espera. Testei sem a ordenação: o Postgres detectou o deadlock e abortou uma das vendas.

2. **O cliente clica duas vezes em "Confirmar venda". O que acontece?**
   O front manda a mesma `Idempotency-Key` nas duas requisições. A primeira cria a venda; a segunda encontra a chave (ou perde a corrida no índice único e tem a transação desfeita) e recebe a mesma venda com status 200. Estoque baixado uma vez só. Se a mesma chave chegar com itens diferentes, é erro do cliente: 409.

3. **Por que o preço não vem do front, se o front já mostra o total?**
   Porque qualquer um pode chamar a API com `unitPrice: 0.01`. O servidor lê o preço do banco, no mesmo comando que baixa o estoque, e grava uma cópia no item da venda. O total mostrado no front é só informativo; o que vale é o calculado no servidor com `Decimal`.

## Fase 5: cancelamento de venda

### Conceitos usados

- **Troca de status atômica e condicional.** `UPDATE sales SET status = 'CANCELADA', ... WHERE id = ... AND status = 'CONCLUIDA' RETURNING id`. É o mesmo padrão da baixa de estoque (`WHERE current_stock >= q`), aplicado ao status: a condição e a escrita são um comando só. Se afetou 0 linhas, o service descobre o motivo (404 se não existe, 409 se já foi cancelada).
- **Estorno reaproveitando o `StockService`.** Cada item volta ao estoque por `StockService.increase(tx, 'ESTORNO', ...)`, dentro da transação do cancelamento, com o `saleId` e o motivo. Como o `increase` não exige produto ativo, o estoque volta mesmo que o produto tenha sido desativado depois da venda.
- **Ordem de locks consistente.** O cancelamento trava a linha da venda e depois os produtos em ordem de `productId`, a mesma ordem da venda. Um cancelamento e uma venda nova dos mesmos produtos nunca formam ciclo.
- **`@Roles` no método vence o da classe.** O `SalesController` libera os três papéis na classe; a rota de cancelamento declara `@Roles('ADMIN', 'GERENTE')` e sobrescreve. É a regra do `getAllAndOverride` do RolesGuard da Fase 1.
- **Banco preparado antes.** Os campos de cancelamento e o CHECK "os três juntos, só em venda cancelada" foram criados na Fase 4. Esta fase não precisou de migration.

### O estorno em dobro que a condição evita

O teste dispara 5 cancelamentos simultâneos da mesma venda e espera `[200, 409, 409, 409, 409]`, com o estoque devolvido uma vez. Conferido nos dois sentidos: **sem** o `AND status = 'CONCLUIDA'`, o resultado foi `[200, 200, 200, 200, 200]`. Os 5 cancelamentos passaram, e o estoque teria voltado 5 vezes: mercadoria que não existe aparecendo no sistema. Com a condição, os 4 últimos esperam a linha da venda, reavaliam o `WHERE` com o status já `CANCELADA` e afetam 0 linhas.

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| `UPDATE ... WHERE status = 'CONCLUIDA'` | Condição e escrita atômicas; sem lock explícito | Ler o status e depois atualizar: dois cancelamentos simultâneos leriam "CONCLUIDA" e estornariam em dobro |
| VENDEDOR não cancela, nem as próprias vendas | Evita a fraude de vender, receber e cancelar | Deixar o vendedor cancelar as próprias: o caixa perderia o registro |
| Estorno também para produto desativado | A mercadoria voltou fisicamente para a loja | Recusar o cancelamento: a venda ficaria sem como ser desfeita |
| Cancelamento total, sem devolução parcial | Resolve o caso principal (venda registrada por engano) com uma regra simples | Devolução parcial: exige controlar, por item, quanto já voltou (fica para próximos passos) |
| Sem prazo limite para cancelar | Fora do MVP, como previsto no plano | Limite por dia ou papel: fica para próximos passos |
| Resposta 200 com a venda atualizada | O front mostra quem cancelou e quando sem outra requisição | 204 sem corpo |

### Perguntas de entrevista

1. **Dois gerentes cancelam a mesma venda ao mesmo tempo. O estoque volta duas vezes?**
   Não. A troca de status é um `UPDATE` condicional (`WHERE status = 'CONCLUIDA'`). O Postgres serializa as duas atualizações na mesma linha; a segunda, ao conseguir a linha, vê o status já `CANCELADA`, afeta 0 linhas e a API responde 409 antes de estornar qualquer item. Testei removendo a condição: os 5 cancelamentos simultâneos passaram.

2. **Por que o vendedor não pode cancelar a própria venda?**
   Porque abriria uma fraude clássica: registrar a venda, receber em dinheiro e cancelar para apagar o registro do caixa. O cancelamento exige alguém de papel superior, com motivo obrigatório e auditoria.

3. **O que acontece com o estoque se o produto foi desativado depois da venda?**
   Volta mesmo assim. Desativar impede vender e dar saída, mas a mercadoria do cancelamento voltou fisicamente para a loja. O estorno usa o `increase` do `StockService`, que não exige produto ativo, e grava uma movimentação ESTORNO ligada à venda.

## Fase 6: alertas e relatórios

### Conceitos usados

- **Fuso horário nos relatórios (risco 11).** Tudo é gravado em UTC (`timestamptz`). O período chega em datas de calendário da loja e vira um intervalo UTC no próprio SQL: `created_at >= (from::date::timestamp AT TIME ZONE tz)` e `created_at < ((to::date + 1)::timestamp AT TIME ZONE tz)`. O agrupamento também é feito no fuso da loja: `date_trunc('day', created_at AT TIME ZONE tz)`. Exemplo: a venda das 23h30 do dia 17 em Fortaleza é 02h30 UTC do dia 18, mas conta no dia 17.
- **As duas direções do `AT TIME ZONE`.** Em `timestamptz AT TIME ZONE 'America/Fortaleza'`, o resultado é o horário de parede em Fortaleza (sem fuso). Em `timestamp AT TIME ZONE 'America/Fortaleza'`, o horário de parede é interpretado como de Fortaleza e vira um instante (`timestamptz`). A consulta usa as duas: uma para agrupar, outra para montar os limites.
- **Períodos zerados com `generate_series`.** Uma CTE gera todos os dias (ou semanas, ou meses) do intervalo, e um `LEFT JOIN` com os totais deixa zerados os que não tiveram venda. O gráfico do front não precisa inventar dias.
- **Agregação no banco.** `SUM`, `COUNT` e `date_trunc` rodam no Postgres. Trazer as vendas para somar em JavaScript seria mais lento e usaria `number` para dinheiro.
- **SQL cru com parâmetros.** As consultas usam `$queryRaw` com template tagged: o fuso, o `groupBy`, as datas e o `limit` viram parâmetros (`$1`, `$2`...), nunca texto concatenado. O `groupBy` já passou pela lista de valores permitidos do DTO antes de chegar ali.
- **Validação de data real.** `"2026-02-30"` passa numa regex `AAAA-MM-DD` e o `Date` do JavaScript transforma em 2 de março. A validação confere que a data reconvertida é igual à digitada.
- **Alerta calculado na consulta (risco 13).** Não existe tabela de alertas: a lista é `current_stock <= min_stock` entre produtos ativos, calculada a cada requisição. Nunca fica desatualizada; o teste confirma que uma venda faz o produto aparecer no alerta na hora.

### Conferido nos dois sentidos

O teste "venda às 23h30 em Fortaleza conta no dia local" foi rodado com `REPORTS_TIMEZONE=UTC`: falhou, porque as duas vendas caíram no dia 18. Com o fuso padrão, passa. O teste prova que o fuso é de fato aplicado, e que trocar a variável de ambiente muda o resultado.

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Datas de calendário em `from`/`to`, convertidas no SQL | Quem pede "1 a 30 de novembro" pensa em dias da loja; o front não precisa acertar o fuso | Receber instantes ISO: cada cliente teria de calcular o fim do dia em Fortaleza |
| Fuso configurável (`REPORTS_TIMEZONE`) | Outra loja, outro fuso, sem mudar código; validado no boot | Fuso fixo no código |
| Períodos vazios zerados no SQL | Gráfico correto sem lógica no front | Devolver só os dias com venda |
| Só vendas `CONCLUIDA` | Venda cancelada não é receita | Contar tudo e mostrar canceladas à parte (pode virar próximo passo) |
| Valor do estoque inclui produtos desativados | A mercadoria continua fisicamente na loja | Só ativos: o valor ficaria menor que o real |
| Limite de 366 dias por consulta | Evita consultas enormes e gráficos ilegíveis | Sem limite |
| Sem tabela de alertas | Calculado na hora, nunca desatualizado | Tabela atualizada por trigger: mais código para o mesmo resultado; vira otimização se houver milhares de produtos |

### Perguntas de entrevista

1. **Como você garante que a venda das 23h aparece no dia certo do relatório?**
   O banco guarda tudo em UTC. O relatório recebe datas da loja e converte no SQL com `AT TIME ZONE` usando o fuso configurado (`America/Fortaleza`), tanto para montar o intervalo quanto para agrupar por dia. Há um teste com vendas às 23h30 e às 00h30 que só passa com o fuso aplicado; rodei com `UTC` para confirmar que ele falha.

2. **Por que somar no SQL e não no código?**
   O banco já tem os dados e índices; trazer milhares de linhas para somar em JavaScript é mais lento e usa `number` (ponto flutuante) para dinheiro. No Postgres, `SUM` sobre `DECIMAL` é exato, e a API só formata o resultado.

3. **O SQL desses relatórios é cru. Isso não abre brecha para injeção?**
   Não, porque nada é concatenado: o `$queryRaw` com template tagged transforma cada valor interpolado em parâmetro da consulta. Além disso, o `groupBy` é validado contra uma lista fixa (`day`, `week`, `month`) antes de chegar ao SQL, e as datas passam por validação de formato e de data real.

## Fase 7: base do front-end

### Conceitos usados

- **Access token só em memória.** O token fica numa variável do módulo `lib/api.ts`, nunca no `localStorage`. Um script injetado (XSS) não encontra token guardado para roubar. O preço: recarregar a página apaga o token. A solução é a primeira chamada do app ser `POST /auth/refresh`: o cookie `httpOnly` (que o JavaScript não lê) devolve uma sessão nova.
- **Renovação transparente com repetição.** O cliente HTTP, ao receber 401 numa rota que não é de autenticação, renova a sessão e repete a chamada uma vez. Se a renovação falha, avisa o `AuthProvider`, que encerra a sessão e o usuário volta ao login.
- **Single-flight.** `refreshing ??= doRefresh().finally(() => { refreshing = null })`: a primeira chamada cria a promessa da renovação; as outras recebem a mesma promessa. Cinco chamadas com 401 ao mesmo tempo geram uma renovação só. Isso também cobre o `StrictMode` do React, que monta os efeitos duas vezes em desenvolvimento.
- **Proxy do Vite.** O front chama `/api/...` na própria origem (`localhost:5173`) e o Vite repassa para `localhost:3000`. Para o navegador, o cookie de refresh é de primeira parte, então o `SameSite=Strict` não o bloqueia, e o `Path=/api/v1/auth` continua valendo.
- **Guarda de rota por papel.** `<RequireAuth roles={[...]}>` redireciona para o login (guardando a página de origem em `location.state`) ou mostra a tela 403. É experiência do usuário; a proteção real é o `RolesGuard` da API. O menu vem da mesma lista (`NAV_ITEMS`), então menu e rotas não divergem.
- **Formato de erro único.** `ApiError` lê `message`, `details` e `requestId` do filtro global do back-end. A tela mostra a mensagem e o código da requisição, que é o que o suporte procura no log.
- **Testes com API simulada.** O MSW intercepta o `fetch` e responde como a API. O estado do mock imita o cookie de sessão. Requisição sem handler falha o teste (`onUnhandledFrame: 'error'`), então nenhum teste passa chamando uma rota que o mock não conhece.
- **Acessibilidade.** Rótulos ligados aos campos, `aria-invalid` e `aria-describedby` nos erros, `role="alert"` nas mensagens da API, link "Pular para o conteúdo", foco visível e `<output>` (status) no carregamento. O `axe-core` roda nas telas de login, layout, 403 e 404, e o lint inclui as regras `jsx-a11y`.

### Conferido nos dois sentidos

- **Single-flight:** trocando a promessa compartilhada por uma renovação por chamada, o teste "3 chamadas com token expirado" falhou com `expected 3 to be 1`: três renovações, exatamente o cenário que o back-end trataria como reuso de token.
- **Contra a API real:** com o banco, a API compilada e o `vite` rodando, o login pelo proxy gravou o cookie com `Path=/api/v1/auth`, o refresh pelo proxy com esse cookie devolveu um token novo, e a chamada autenticada respondeu 200 (401 sem token).

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Token em memória + refresh no carregamento | Nenhum token legível por JavaScript | `localStorage`: sobrevive ao recarregar, mas qualquer XSS lê |
| Renovação single-flight | Respeita a detecção de reuso do back-end | Cada chamada renova sozinha: derruba a própria sessão |
| Proxy do Vite em desenvolvimento | Mesma origem: cookie `Strict` funciona sem mudar a API | CORS com `SameSite=None`: enfraquece a proteção contra CSRF |
| `axe-core` direto | Sem depender de pacote parado | `vitest-axe` 0.1.0 |
| MSW nos testes | Testa o cliente HTTP de verdade (cabeçalhos, 401, repetição) | Mockar o módulo `api`: não testaria a renovação |
| Menu e rotas da mesma lista | Um item novo aparece no menu e ganha a guarda juntos | Listas separadas: fácil esquecer uma |
| TypeScript 6 no front | Mesma versão do back-end | TypeScript 7: duas versões no mesmo repositório |

### Perguntas de entrevista

1. **Onde você guarda o JWT no front-end, e por quê?**
   O access token fica só em memória; o refresh token fica num cookie `httpOnly`, `SameSite=Strict`, que o JavaScript não consegue ler. Assim um XSS não tem token para roubar. Quando a página recarrega, o app chama o refresh e o cookie devolve uma sessão nova.

2. **O token expirou e a tela dispara cinco requisições ao mesmo tempo. O que acontece?**
   As cinco recebem 401. A primeira inicia a renovação e as outras quatro aguardam a mesma promessa. Com o token novo, as cinco são repetidas. Se cada uma renovasse sozinha, o back-end veria o mesmo refresh token usado várias vezes e trataria como roubo. Testei isso: sem o single-flight, aconteceram três renovações em vez de uma.

3. **Se o menu já esconde "Usuários" do vendedor, por que o back-end ainda checa o papel?**
   Porque o front roda no computador do usuário: qualquer um pode chamar a API direto, sem a tela. O menu e a guarda de rota são experiência; a segurança é o `RolesGuard` da API, que nega por padrão.

## Fase 8a: telas de catálogo

### Conceitos usados

- **Estado da listagem na URL.** `useListParams` lê página, busca, ordenação e filtros de `useSearchParams`. O F5 e o botão voltar mantêm a lista, e o endereço de uma busca pode ser compartilhado. Como a URL pode ser editada à mão, tudo é validado ao ler: `?sort=senha` vira `name`, `?page=abc` vira 1. Mudar busca, filtro ou ordenação volta para a página 1, porque a página 5 de uma busca nova pode não existir.
- **Chave da query = parâmetros da tela.** `queryKey: ['products', 'list', filtros]`: cada combinação de filtros tem seu cache. `keepPreviousData` mantém a página anterior na tela enquanto a próxima carrega, sem a tabela piscar. Depois de salvar, `invalidateQueries({ queryKey: ['products'] })` marca como velhas a lista e o detalhe de uma vez.
- **Input diferente do output no formulário.** O schema zod recebe o que a pessoa digita ("5,50", "12") e entrega o que a API espera ("5.50", 12). Por isso o `useForm` tem dois tipos: `useForm<z.input<...>, unknown, z.output<...>>`. O mesmo vale para o fornecedor: campo vazio vira `null`, que no PATCH apaga o valor gravado.
- **Dinheiro sem conta no front.** O valor vem como string ("5.50") e só vira `number` para o `Intl.NumberFormat` exibir. Nenhuma soma é feita no navegador, então o erro de ponto flutuante nunca chega à API.
- **Papel na tela é UX.** O VENDEDOR não vê a coluna Custo nem os botões de cadastro, mas quem garante é o back-end: o `costPrice` nem vem na resposta, e as rotas de escrita respondem 403. O mock do MSW imita isso (a chave some para o VENDEDOR), então o teste confere a tela com a resposta real.
- **Acessibilidade de tabela e formulário.** `aria-sort` no cabeçalho ordenado (o botão dentro do `th` recebe o foco), `<caption>` em cada tabela, `aria-label` nos botões de linha ("Editar Cerveja", não só "Editar"), `<output>` como região viva para "Produto desativado", `<search>` como landmark de busca e foco levado ao campo ao abrir o "Renomear". O status de estoque baixo é texto, não só cor.

### Conferido nos dois sentidos

- **Regra de papel:** mostrando a coluna Custo para todos (`canManage = true`), o teste "VENDEDOR: sem coluna de custo" falhou.
- **URL editada à mão:** trocando a validação por `rawSort ?? defaultSort`, o teste "ordenação desconhecida volta ao padrão" falhou.
- **Contra a API real:** pelo proxy do Vite, com o banco e a API compilada, as mesmas chamadas das telas responderam como esperado: listagens com `active`, `lowStock`, `categoryId` e ordenação (200), corpos dos formulários com `null` e preço em texto (201/200), SKU repetido (409), validação com `details` em lista (400), categoria em uso (409), desativar e reativar (204/200).

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Filtros na URL | Sobrevivem ao F5, ao voltar e podem ser compartilhados | `useState`: perde tudo ao navegar |
| Formulário em rota própria | Sem trap de foco; link de edição compartilhável | Modal: mais código de acessibilidade |
| Categoria editada na linha | Só tem nome e a API não tem `GET /categories/:id` | Criar o endpoint só para preencher um campo |
| Busca no Enter | Uma requisição por busca, sem respostas fora de ordem | Busca a cada tecla com debounce |
| Categorias e Fornecedores no menu | Permissões diferentes de Produtos | Abas dentro de Produtos |
| `window.confirm` | Diálogo nativo, acessível e fácil de testar | Diálogo próprio com `aria-modal` e trap de foco |
| Mock com regras do back-end | O teste de papel falha se a tela depender de um campo que a API não manda | Mock que devolve tudo para todos |

### Perguntas de entrevista

1. **Por que guardar filtros e paginação na URL?**
   Porque a URL é o estado que o navegador já sabe guardar: F5, voltar e compartilhar um link funcionam sem código extra. O cuidado é tratar a URL como entrada do usuário: valido página e ordenação ao ler, e um valor inválido volta ao padrão em vez de virar erro.

2. **O usuário digita "1.234,56" no preço. O que a API recebe, e por que não um number?**
   Recebe a string "1234.56". O schema zod troca o separador e confere o formato igual ao do back-end. Não mando number porque o JSON passaria por ponto flutuante (0.1 + 0.2 não dá 0.3); a string vai direto para o `DECIMAL` do Postgres.

3. **Se o VENDEDOR abrir o DevTools e mostrar a coluna de custo, ele vê o custo?**
   Não. A coluna escondida é só experiência: o back-end nem manda o `costPrice` para o VENDEDOR. Nos testes, o mock da API também omite o campo para esse papel, e um teste falha se a coluna aparecer.

## Fase 8b: telas de estoque

### Conceitos usados

- **União discriminada no zod.** `z.discriminatedUnion('type', [entrada, saida, ajuste])` escolhe o schema pelo valor do campo `type`. Cada tipo tem as próprias regras: a ENTRADA tem motivo opcional, a SAÍDA exige motivo, e o AJUSTE usa `countedStock` no lugar de `quantity`. É o mesmo contrato do `@ValidateIf` no DTO do back-end, agora checado antes da requisição. Como o `z.object` descarta chaves desconhecidas, a quantidade digitada antes de trocar para Ajuste não vai para a API.
- **Formulário com dados de vários tipos.** O `useForm` guarda todos os campos como texto (`FormValues`) e o schema entrega o corpo já convertido (`FormOutput`). Trocar de tipo não perde o que foi digitado. O cast no `zodResolver` existe porque nenhum ramo da união aceita sozinho todos esses campos.
- **Erro da API com dados úteis.** O 409 de estoque insuficiente traz `details.available`. A tela mostra "Disponível agora: N" e busca o produto de novo, porque o saldo mudou depois que a tela foi aberta.
- **Datas sem fuso viram instantes.** O `<input type="date">` dá "2026-11-15", sem hora. `startOfDayIso` e `endOfDayExclusiveIso` convertem para ISO usando o fuso do navegador, e o "até" vira o início do dia seguinte, porque o `to` da API é exclusivo.
- **Cache do React Query.** Ao voltar do histórico de um produto para o extrato geral, nenhuma requisição é feita: a `queryKey` já estava em cache e ainda não tinha passado do `staleTime`. Depois de lançar uma movimentação, as chaves `stock-movements`, `products` e `stock-alerts` são invalidadas juntas, porque as três dependem do saldo.
- **Sinal além da cor.** No extrato, a quantidade aparece como "+4" ou "-2", e não só em verde ou vermelho: a cor sozinha não chega a quem não distingue cores nem ao leitor de tela.

### Conferido nos dois sentidos

- **Fim exclusivo:** sem somar um dia em `endOfDayExclusiveIso`, o teste "até inclui o dia inteiro" falhou.
- **Saldo disponível no 409:** ignorando o `details` (`status !== 410` no lugar de 409), o teste "SAÍDA maior que o saldo" falhou.
- **Contra a API real:** pelo proxy do Vite, ENTRADA sem motivo (201), SAÍDA acima do saldo (409 com `details.available`), AJUSTE (201, quantidade calculada pelo servidor), AJUSTE sem diferença (400), AJUSTE com `quantity` junto (400, o caso que o zod evita), histórico por produto com período e tipo, produto inexistente (404) e alertas ordenados pela maior falta.

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| `discriminatedUnion` por tipo | Regras por tipo num lugar só, iguais às do DTO | `superRefine` com vários `if` |
| Campos de todos os tipos no formulário | Trocar de tipo não apaga o que foi digitado | `reset` a cada troca de tipo |
| Busca de produto com rádio | Acessível sem código extra | Combobox ARIA próprio |
| Prévia do ajuste no navegador | A pessoa confere antes de gravar | Só mostrar o resultado depois |
| Extrato por produto na mesma tela (`?produto=`) | Filtros e paginação reaproveitados | Uma tela separada de histórico |
| Alertas na tela inicial, top 5 | A API já ordena pela maior falta | Mais uma tela só de alertas |

### Perguntas de entrevista

1. **Por que validar no front se o back-end já valida?**
   Por experiência: o erro aparece no campo, antes da requisição. A regra que vale continua sendo a do back-end, que recebe chamadas de qualquer cliente. O schema do front é uma cópia do contrato, e os testes com o mock e as chamadas contra a API real conferem que as duas versões concordam.

2. **Duas pessoas lançam uma saída do mesmo produto ao mesmo tempo. O que a tela mostra?**
   O back-end trava a linha do produto e a segunda saída, se passar do saldo, recebe 409 com o saldo disponível. A tela mostra "Disponível agora: N" e busca o produto de novo. A prévia do ajuste também é só informativa: o servidor recalcula a diferença dentro da transação.

3. **Por que o filtro "até 15/11" manda 16/11 para a API?**
   Porque o `to` da API é exclusivo (`createdAt < to`). Mandar 15/11 00:00 deixaria o dia 15 inteiro de fora. Um intervalo meio aberto evita a dúvida sobre "23:59:59.999" e encaixa períodos seguidos sem sobreposição.

## Fase 9a: telas de vendas

### Conceitos usados

- **Idempotência do lado do cliente.** A API já deduplicava vendas pela `Idempotency-Key`, mas quem decide que uma requisição "é a mesma" é o cliente. A chave fica num `useRef` (`keyRef`), nasce no primeiro envio (`keyRef.current ??= newIdempotencyKey()`) e é reusada se a rede cair. Se o carrinho muda, a chave é apagada, porque já é outra venda. `useRef`, e não `useState`, porque trocar a chave não precisa redesenhar a tela.
- **Erro de rede é diferente de erro da API.** Um 409 é uma resposta: o servidor decidiu e não gravou nada. Um `TypeError` do `fetch` significa que não houve resposta, e a venda pode ter sido gravada ou não. A tela diz isso com todas as letras e explica que tentar de novo é seguro.
- **Dinheiro em centavos.** `0.1 * 3` dá `0.30000000000000004` em JavaScript. A prévia do total converte "5.50" para 550 centavos e soma inteiros. O total oficial continua vindo do servidor.
- **Foco depois de mudar a tela.** Ao abrir o cancelamento, o foco vai para o campo do motivo. Ao desistir, volta para o botão "Cancelar venda". Sem isso, o foco cairia no `<body>`, e quem usa teclado recomeçaria do topo.
- **Mensagem que sobrevive à mudança de estado.** No 409 "Venda já cancelada", a venda recarrega como CANCELADA e o formulário desmonta, levando junto o erro dele. Por isso o aviso sobe para a página (`onAlreadyCanceled`).
- **Elemento `<search>`.** É o equivalente semântico de `role="search"` (o lint `prefer-tag-over-role` apontou). O leitor de tela anuncia a região como busca.

### Conferido nos dois sentidos

- **Mutation checks**, cada um derrubando pelo menos um teste: chave nova a cada envio, carrinho mudando sem trocar a chave, produto repetido sem somar, validação de saldo removida, aviso do 409 removido, foco não devolvido e ordem padrão da lista ignorada.
- **Rede caindo depois de gravar:** o mock tem a opção `dropNextSaleResponse`, que grava a venda e devolve um erro de rede. O teste confere que o segundo clique manda a mesma chave, que só uma venda existe e que o estoque baixou uma vez.
- **Contra a API real:** venda (201), retry com a mesma chave (200, mesma venda), mesma chave com outros itens (409), sem chave (400), estoque insuficiente (409 com `details` no topo da resposta, como o mock supõe), VENDEDOR sem `costPrice`/`unitCost`, lista com os parâmetros da tela, VENDEDOR cancelando (403), motivo em branco (400), cancelamento com estorno do saldo, segundo cancelamento (409) e VENDEDOR abrindo venda de outra pessoa (404).

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Chave reusada até o carrinho mudar | Retry seguro depois de queda de rede | Chave nova a cada clique (duplicaria a venda) |
| Erro explícito sem `crypto.randomUUID` | Chave previsível quebraria a deduplicação | Fallback com `Math.random` |
| Carrinho em `useState` | Linhas nascem de cliques, validação é uma função pura | `useFieldArray` do react-hook-form |
| Prévia em centavos inteiros | Sem erro de ponto flutuante | Somar `Number(salePrice) * qtd` |
| Cancelamento com formulário na página | Motivo é obrigatório | `window.confirm`, que não tem campo |
| Sem filtro por vendedor | `GET /users` é só do ADMIN | Campo que o GERENTE veria vazio |

### Perguntas de entrevista

1. **O vendedor clica em "Registrar venda", a rede cai e ele clica de novo. A venda sai duplicada?**
   Não. O primeiro clique gerou um UUID e mandou no header `Idempotency-Key`. O segundo clique, com o carrinho igual, manda a mesma chave. Se o servidor gravou na primeira vez, ele encontra a venda pela chave e devolve a mesma (200), sem baixar o estoque de novo. Se não gravou, grava agora. O índice único na coluna da chave resolve até o caso de as duas requisições chegarem juntas.

2. **Por que o preço não vai no corpo da venda, se a tela já mostra o preço?**
   Porque o preço da tela pode estar velho ou ter sido editado no navegador. O servidor lê o preço do banco no mesmo comando que baixa o estoque, e o DTO recusa `unitPrice` (400). O total da tela é só uma prévia, e por isso a tela avisa que o valor confirmado é o do servidor.

3. **Por que o VENDEDOR recebe 404, e não 403, ao abrir a venda de outra pessoa?**
   Um 403 confirmaria que aquele id existe, o que é um vazamento de informação (IDOR). Com 404, "não existe" e "não é sua" ficam iguais para quem está de fora. A lista também filtra pelo id que vem do token, nunca por um parâmetro que o cliente possa trocar.

## Fase 9b: relatórios

### Conceitos usados

- **Duas convenções de data na mesma API.** A lista de vendas filtra **instantes** (ISO, com o fim exclusivo), e o front converte usando o fuso do navegador. Os relatórios agrupam por **dia do calendário da loja** (`AAAA-MM-DD`, inclusivo), e o fuso é aplicado no servidor. Se o relatório usasse o fuso de quem olha, um gerente viajando veria a venda das 21h45 de Fortaleza no dia seguinte. Conferido contra a API real: uma venda gravada às 00:4x UTC do dia 20 aparece no dia 19.
- **Data de calendário sem UTC.** `new Date("2026-11-20")` é meia-noite **UTC**, que no Brasil ainda é dia 19. As funções de `dates.ts` montam a data com ano, mês e dia locais e usam o meio-dia, longe da virada do dia.
- **Gráfico desenhado à mão.** Escala linear (`y = base - valor / topo * altura`), passos "redondos" no eixo (1, 2 ou 5 x 10^n, em `niceTicks`) e largura medida com `ResizeObserver` para desenhar em pixels, porque com um `viewBox` fixo o texto encolheria no celular.
- **Acessibilidade de gráfico.** O SVG é decorativo (`aria-hidden`). Os números completos estão na tabela. O teclado usa um `<input type="range">` com `aria-valuetext`: o leitor de tela lê "17/11/2026, 2 vendas: R$ 46,30" sem região viva. O lint conduziu essa escolha, primeiro recusando um `div` focável e depois preferindo o elemento nativo ao `role="slider"`.
- **Cancelamento de requisição.** O React Query entrega um `AbortSignal` ao `queryFn`. Se o `signal` é repassado ao `fetch`, sair da tela cancela a requisição de verdade. Sem isso, a requisição continua e a resposta é descartada.
- **Vazamento entre testes.** Um teste falhou sem ter nada de errado: o teste anterior terminava com requisições pendentes, que voltavam com 401 depois de o `afterEach` limpar o token e disparavam um refresh contado no teste seguinte. Rodar o teste isolado (`-t`) separou "teste errado" de "teste contaminado".

### Conferido nos dois sentidos

- **Mutation checks** (12), cada um derrubando pelo menos um teste: sem limite de 366 dias, início depois do fim aceito, API chamada com período inválido, "Este mês" errado, gráfico de uma coluna, ticket `null` virando R$ 0, seta para a esquerda quebrada, teclado sem o `onKeyDown`, coluna de valor zero desenhada, "hoje" em UTC, barra não relativa ao maior e `signal` não repassado ao `fetch`.
- **Uma mutação que não foi aplicada:** o texto procurado não bateu com o arquivo, e o "30 passed" não provava nada. Refeita com o texto exato, ela derrubou o teste. Lição: confirmar que o mutante existe antes de ler o resultado.
- **Contra a API real:** períodos zerados, semana começando em 26/10, mês único, ticket `null`, início depois do fim (400), 367 dias (400) e 366 (ok), mais vendidos, valor do estoque com desativados e VENDEDOR (403).

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Uma página, período compartilhado | Menos cliques, números que concordam entre si | Uma rota por relatório; abas |
| SVG próprio | Zero kB a mais, controle total da acessibilidade | Recharts (~100 kB) |
| Barras dentro da tabela no ranking | Cada valor já escrito, sem hover | Outro gráfico em SVG |
| `<input type="range">` no teclado | Papel, foco e anúncio nativos | `div` focável com `role` |
| Período padrão fora da URL | Favorito continua sendo "este mês" | Gravar as datas na URL ao abrir |
| `AbortSignal` repassado | Cancela de verdade e isola os testes | Fazer o teste esperar a página carregar |

### Perguntas de entrevista

1. **Por que o relatório recebe "2026-11-20" e a lista de vendas recebe um instante ISO?**
   Porque perguntam coisas diferentes. A lista pergunta "o que aconteceu entre estes dois momentos", e o momento depende do fuso de quem filtra. O relatório pergunta "quanto a loja vendeu no dia 20", e o dia é o do calendário da loja, igual para qualquer pessoa. Por isso o fuso do relatório fica no servidor, numa variável de ambiente.

2. **Como um gráfico em SVG fica acessível?**
   O desenho fica escondido do leitor de tela, e a mesma informação aparece de outro jeito: uma tabela com todos os números, um rótulo no maior valor e, no teclado, um controle de faixa nativo que anuncia o período e o valor a cada seta. A cor da série foi validada para contraste, e nenhum dado depende só da cor.

3. **Um teste começou a falhar sem você ter mexido nele. Como você investigou?**
   Rodei o teste sozinho e ele passou, então o problema vinha de outro teste. O anterior fazia login e caía na página de relatórios, que agora faz requisições. Ele terminava antes das respostas, o `afterEach` limpava o token, as respostas voltavam com 401 e disparavam um refresh contado no teste seguinte. A correção foi cancelar as requisições quando a tela desmonta, repassando o `AbortSignal` do React Query ao `fetch`. Isso também melhora o app real.

## Fase 9c-1: leitura da auditoria e acesso negado auditado

### Conceitos usados

- **Guard assíncrono.** `canActivate` pode devolver `Promise<boolean>`. O `RolesGuard` passou a ser `async` porque precisa esperar a gravação do acesso negado antes de lançar o 403. Os testes mudaram de `toThrow` para `rejects.toThrow`: com uma função assíncrona, o erro chega como promessa rejeitada, não como exceção lançada na hora.
- **Fail closed.** Quando a parte acessória (a auditoria) falha, o resultado tem que ser o lado seguro (negar). O `try/catch` em volta da gravação só existe para isso: o erro vai para o log e o `ForbiddenException` é lançado do mesmo jeito.
- **Auditoria com e sem transação.** Nos services, a auditoria entra na mesma transação da ação (as duas ou nenhuma). No acesso negado não existe ação, então a gravação é avulsa.
- **Padrão da rota, não a URL.** No Express, depois que a rota é encontrada, `request.route.path` é o padrão (`/api/v1/users/:id`). Guardar o padrão evita levar para a auditoria a query string e o id pedido.
- **Tipo derivado de valor.** `type AuditAction = (typeof AUDIT_ACTIONS)[number]`: o array existe em tempo de execução (o `@IsIn` precisa dele) e o tipo sai dele, com uma única fonte da verdade.
- **Paginação estável.** Ordenar só por `createdAt` não é determinístico quando dois registros têm o mesmo milissegundo: o banco pode devolvê-los em ordem diferente a cada consulta, e um registro aparece em duas páginas ou em nenhuma. O `id` como segundo critério resolve.

### Conferido nos dois sentidos

- **Mutation checks** (5), cada um derrubando pelo menos um teste: guard que não grava, URL no lugar do padrão da rota, `to` inclusivo, `from` depois de `to` aceito e falha da auditoria propagando para fora do guard. Este último só é pego pelo teste unitário, como esperado: no e2e o banco nunca falha.
- **Contra a API real:** VENDEDOR recebe 403 em `/audit-logs` e em `/users?search=x`, os dois registros aparecem no filtro `action=ACCESS_DENIED` com a rota e sem o `search`, `from` depois de `to` responde 400 e a rota está no Swagger.

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Auditar toda negação por papel | Rota aberta aos três papéis nunca nega; nada fica de fora por esquecimento | Decorator opt-in `@AuditDenied()` |
| Não auditar rota sem `@Roles` | É bug de quem escreveu, não tentativa de acesso | Gravar todo 403 |
| Esperar a gravação antes do 403 | O registro existe quando o cliente recebe a resposta | Gravar sem `await` (mais rápido, mas pode se perder) |
| Período sem limite de dias | A paginação já limita a resposta | Limite de 366 dias como nos relatórios |
| Usuário junto no registro | A tela mostra o nome sem segunda chamada | Devolver só o `userId` |

### Perguntas de entrevista

1. **Se o banco cair na hora de gravar o acesso negado, o que acontece?**
   A pessoa continua recebendo 403. A gravação fica num `try/catch` que só registra o erro no log. Uma falha na auditoria nunca pode virar acesso liberado: é o princípio de "fail closed".

2. **Por que a auditoria guarda `/api/v1/users/:id` e não a URL que a pessoa chamou?**
   A URL pode trazer dados na query string, como um termo de busca, e a auditoria só deve guardar o necessário. O padrão da rota, junto com o método, o papel e os papéis exigidos, já diz o que foi tentado.

3. **Como você evita que a mesma linha apareça em duas páginas da listagem?**
   Com uma ordenação determinística: `createdAt` e depois `id`. Só com a data, registros do mesmo milissegundo podem vir em ordem diferente a cada consulta, e o `OFFSET` da página seguinte pode repetir ou pular algum. O teste e2e percorre todas as páginas com `pageSize=2` e confere que cada id aparece uma vez só.

## Fase 9c-2: telas de usuários, auditoria e troca de senha

### Conceitos usados

- **Estado que sobrevive a um redirecionamento.** Depois de trocar a senha, duas coisas querem levar a pessoa ao login: a própria tela e o `RequireAuth`, que percebe a sessão encerrada. Quem renderiza primeiro vence, e isso não é garantido. A solução foi tirar a disputa: só o `RequireAuth` redireciona, e o aviso fica num lugar que os dois enxergam (o contexto de auth), em vez de viajar no `state` da navegação.
- **Encerrar a sessão sem falar com o servidor.** O `endSession` limpa o token em memória e o cache do React Query. O `logout` faz isso e também avisa a API. Depois de trocar a senha, a API já encerrou tudo, então avisar de novo só geraria um 401.
- **Schema que muda com o modo do formulário.** `schemaFor(creating)` devolve um schema só, com `superRefine` (a senha é obrigatória só na criação) e `transform` (a senha nem sai na edição). O `useForm<Input, unknown, Output>` separa o que o formulário guarda do que vai para a API.
- **Campo desabilitado não é enviado.** No react-hook-form, `register('role', { disabled: true })` tira o campo do resultado. Isso evita mandar o próprio papel, mesmo sem mudança.
- **Diferença entre dois objetos.** `diffRows` junta as chaves de `before` e `after` e compara cada valor com `JSON.stringify`, que serve para valores de JSON. Quando só existe um dos lados (criação), nada é marcado como alterado: não há com o que comparar.
- **Acessibilidade de listas repetidas.** Vários "Ver detalhes" iguais não dizem nada a quem usa leitor de tela. Um trecho `sr-only` dentro do `summary` acrescenta "de Preço alterado em 19/11/2026, 12:00".

### Conferido nos dois sentidos

- **Mutation checks** (12), cada um conferido como aplicado e derrubando pelo menos um teste: troca de senha sem aviso, `from` gravado mesmo com aviso, botão de desativar na própria linha, papel habilitado na própria conta, diferença nunca marcada, ação da URL sem validação, senha enviada na edição, papel traduzido em qualquer campo, fim do período sem incluir o último dia, confirmação de senha ignorada, senha inicial curta aceita e filtro de papel não enviado.
- **Um bug achado pelo teste:** a primeira versão da troca de senha navegava para o login com o aviso no `state`. O teste falhou; um `console.log` do `state` mostrou `{ from: "/minha-senha" }` em vez do aviso. Era o `RequireAuth` vencendo a corrida.
- **Contra a API real:** a lista com os parâmetros que a tela envia, `GET /users/:id` para o chip, a auditoria com os instantes gerados pelo navegador, o 403 de desativar a si mesmo, a edição sem senha, a senha atual errada (400, e não 401) e a troca certa (204, com o token antigo passando a dar 401).

### Decisões e alternativas descartadas

| Decisão | Por quê | Alternativa descartada |
|---|---|---|
| Aviso no contexto de auth | Um único redirecionamento, sem corrida | `navigate` com o aviso no `state` |
| `endSession` em vez de `logout` | A sessão já acabou no servidor | `logout`, que daria 401 e refresh |
| Filtro de usuário pela URL e chip | Não carrega a lista toda; o link da tela de usuários sai de graça | `<select>` com todos os usuários |
| `<details>` nativo | Teclado e leitor de tela prontos | Modal próprio |
| Sem botão de desativar na própria linha | Evita um erro previsível | Botão desabilitado (some do foco sem explicação) |
| Um schema zod com `superRefine` | Tipagem única no `useForm` | Dois schemas, um por modo |

### Perguntas de entrevista

1. **Depois de trocar a senha, por que o front não chama o logout?**
   Porque a API já encerrou todas as sessões, inclusive a atual. Chamar o logout com um token revogado daria 401, o cliente tentaria renovar a sessão e falharia. A tela só limpa o lado do navegador (token em memória e cache), e o guarda de rota leva ao login com o aviso.

2. **Você esconde o botão de desativar a própria conta. Isso é segurança?**
   Não. É experiência de uso. A regra está no service do back-end, que responde 403 a qualquer cliente que tente. A tela só evita que a pessoa clique em algo que vai falhar.

3. **Como você achou o bug do aviso que sumia?**
   O teste esperava o aviso na tela de login e não encontrou. Imprimi o `state` da navegação e ele tinha `from: "/minha-senha"`: quem tinha levado ao login era o `RequireAuth`, não a tela. Eram dois redirecionamentos disputando. Em vez de mexer na ordem das chamadas, deixei um só responsável e coloquei o aviso num estado compartilhado.
