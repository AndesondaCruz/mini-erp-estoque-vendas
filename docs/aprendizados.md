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
