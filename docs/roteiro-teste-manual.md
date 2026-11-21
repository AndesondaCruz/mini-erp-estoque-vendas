# Roteiro de teste manual no navegador (Fase 10d)

Os testes automatizados cobrem a API (unitários e e2e), o front (Testing Library e axe-core) e o Compose (smoke test). O que eles não cobrem é um navegador de verdade: CSP aplicada pelo Nginx, cookie de sessão depois do F5, gráfico renderizado, foco do teclado e layout em tela pequena. Este roteiro fecha essa lacuna.

Marque cada item com `[x]`. Quando algo não sair como o esperado, anote o número do item e o que aconteceu (com print, se der).

## 0. Preparação

- [x] 0.1 Na raiz: `docker compose up --build --detach --wait`
- [x] 0.2 Dados de demonstração (APAGA o banco do Compose): `docker compose exec -T api node dist/seed-demo.js --reset`
- [x] 0.3 Abrir http://localhost:8080 numa janela anônima do Chrome ou do Firefox, com as DevTools abertas nas abas Console e Network. Na Network, marcar "Preserve log".
- [x] 0.4 Anotar o navegador e a versão: ______________________

Contas (senha `demo-mini-erp` para as três):

| Papel    | E-mail                      |
|----------|-----------------------------|
| ADMIN    | `admin.demo@example.com`    |
| GERENTE  | `gerente.demo@example.com`  |
| VENDEDOR | `vendedor.demo@example.com` |

O login aceita 5 tentativas por minuto por IP. Se aparecer "muitas tentativas", espere 1 minuto.

## 1. Checagens gerais (valem durante todo o roteiro)

- [x] 1.1 O Console não mostra nenhum erro, em especial nenhum `Content-Security-Policy` ou `Refused to ...`.
- [x] 1.2 Na aba Network, nenhuma requisição vermelha inesperada. Os 401 que aparecem antes do login são esperados.
- [x] 1.3 Em Application (Chrome) ou Armazenamento (Firefox), em Cookies de `localhost`: existe o cookie de refresh com `HttpOnly`, `Secure` e `SameSite=Strict`, no caminho da API.
- [x] 1.4 Nenhum token aparece em Local Storage nem em Session Storage.

## 2. Login e sessão

- [x] 2.1 Login com senha errada mostra "Credenciais inválidas" e não diz se o e-mail existe.
- [x] 2.2 Login como VENDEDOR leva à tela Início.
- [x] 2.3 F5 na tela Início continua logado. Se cair no login, anote o navegador: é a limitação conhecida do cookie `Secure` em `http://localhost` (decisão 93).
- [x] 2.4 F5 em uma rota interna (por exemplo `/vendas`) abre a mesma tela, e não um 404 do Nginx.
- [x] 2.5 Abrir `http://localhost:8080/rota-que-nao-existe` mostra a página 404 do sistema.
- [x] 2.6 Sair (logout) volta ao login. O botão "voltar" do navegador não mostra dados da sessão anterior.

## 3. VENDEDOR (`vendedor.demo@example.com`)

- [x] 3.1 O menu mostra só Início, Produtos e Vendas.
- [x] 3.2 Produtos: a lista não tem coluna de preço de custo nem botões de criar ou editar.
- [x] 3.3 Vendas: aparecem só as vendas do próprio vendedor.
- [x] 3.4 Nova venda: buscar um produto, adicionar 2 itens, alterar uma quantidade e clicar em "Registrar venda". A venda aparece no detalhe com número e total corretos.
- [x] 3.5 Nova venda com quantidade maior que o estoque mostra um erro claro, e nenhuma venda é criada.
- [x] 3.6 Duplo clique rápido em "Registrar venda" cria uma venda só: o botão fica desabilitado ("Registrando...") e a chave de idempotência cobre o resto.
- [x] 3.7 No detalhe da venda não existe o botão "Cancelar venda".
- [x] 3.8 Digitar `http://localhost:8080/usuarios` na barra mostra a página 403 do sistema.
- [x] 3.9 "Minha senha": tentar trocar a senha mostra a mensagem de conta de demonstração, e a senha continua a mesma (sair e entrar de novo funciona).

## 4. GERENTE (`gerente.demo@example.com`)

- [x] 4.1 O menu mostra Início, Produtos, Categorias, Fornecedores, Vendas, Estoque e Relatórios. Não mostra Usuários nem Auditoria.
- [x] 4.2 Início: aparece o bloco "Produtos abaixo do estoque mínimo", com pelo menos 2 produtos.
- [x] 4.3 Produtos: o filtro "abaixo do mínimo" funciona; ordenar por coluna e paginar funcionam; o filtro continua aplicado depois do F5 (está na URL).
- [x] 4.4 Criar um produto, editá-lo e conferir que o SKU é aceito em minúsculas e salvo em maiúsculas.
- [x] 4.5 Vendas: aparecem as vendas de todos os vendedores, com as canceladas marcadas.
- [x] 4.6 Cancelar a venda feita no item 3.4, informando o motivo. O status muda para cancelada e o estoque dos produtos volta.
- [x] 4.7 Estoque: o extrato mostra entradas, saídas, estornos e ajustes, e o filtro por tipo funciona.
- [x] 4.8 Nova movimentação: uma ENTRADA soma ao saldo; um AJUSTE pede o saldo contado, e não a diferença.
- [x] 4.9 Relatórios: o gráfico de vendas aparece agrupado por dia, por semana e por mês, sem sobreposição de rótulos. Passar o mouse numa coluna mostra a dica com o período e o valor em R$.
- [x] 4.9b Gráfico pelo teclado: Tab até o gráfico mostra a dica da primeira coluna, e as setas percorrem as colunas.
- [x] 4.10 Relatórios: produtos mais vendidos e valor do estoque aparecem preenchidos.

## 5. ADMIN (`admin.demo@example.com`)

- [x] 5.1 O menu mostra todas as seções, inclusive Usuários e Auditoria.
- [x] 5.2 Usuários: desativar `vendedor.demo@example.com` mostra a mensagem de conta de demonstração. O mesmo vale para mudar o papel ou o e-mail.
- [x] 5.3 Usuários: editar e desativar `carla.souza@example.com` (conta comum) funciona.
- [x] 5.4 Usuários: criar um usuário novo, entrar com ele em outra janela anônima, e trocar a senha dele funciona.
- [x] 5.5 Auditoria: aparecem as ações deste roteiro (venda criada, venda cancelada, usuário atualizado, acesso negado do item 3.8), e o detalhe mostra o antes e o depois.
- [x] 5.6 Produtos: desativar um produto funciona, e ele some da busca da nova venda.

## 6. Acessibilidade e layout

- [x] 6.1 Na tela de login e na de nova venda, dá para fazer tudo só com o teclado (Tab, Shift+Tab, Enter), e o foco fica sempre visível.
- [x] 6.2 Os erros de formulário são lidos junto do campo, e o foco vai para o primeiro campo com erro.
- [x] 6.3 No modo responsivo das DevTools (375 px de largura): menu, listas, nova venda e relatórios cabem sem rolagem horizontal da página. Tabelas largas podem rolar dentro do próprio quadro.
- [x] 6.4 Zoom de 200%: o texto continua legível e nada fica cortado.

## 7. Prints para o README

Salvos em `docs/image/`, em PNG:

- [x] 7.1 `tela-login.png`: tela de login
- [x] 7.2 `tela-inicio-gerente.png`: Início como GERENTE, com o alerta de estoque mínimo
- [x] 7.3 `venda-registrada.png`: venda registrada com 3 itens
- [x] 7.4 `relatorio.png`: relatório de vendas por dia
- [x] 7.5 `auditoria.png`: auditoria com o detalhe de uma venda aberto
- 7.6 `mobile.png` (opcional): não tirado. O layout em 375 px foi conferido no item 6.3.

## 8. Depois do roteiro

- [x] 8.1 Restaurar os dados: `docker compose exec -T api node dist/seed-demo.js --reset`

## Resultado

- Data: 21/11/2026
- Navegador: Firefox
- Itens com problema: nenhum.
- Observações: os prints revelaram dois pontos de interface na auditoria (array de itens exibido como JSON e coluna "Quem" estreita), corrigidos em PR separado.
