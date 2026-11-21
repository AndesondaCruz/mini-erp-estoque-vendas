# Post do LinkedIn

Texto aprovado em 21/11/2026, agendado pelo Typefully para segunda-feira, 23/11/2026, às 8h (horário de Brasília).

---

A internet do caixa caiu bem na hora em que o vendedor clicou em "Registrar venda". Ele clica de novo. A venda foi registrada uma vez ou duas? E o estoque baixou quantas vezes?

Esse foi um dos problemas que resolvi no Mini-ERP, um sistema de estoque e vendas para pequenos comércios que acabei de colocar no ar.

Cada tentativa de venda leva uma chave única gerada no navegador. Se o mesmo pedido chegar duas vezes, o servidor devolve a venda que já existe em vez de criar outra. E a baixa do estoque é feita num único comando no banco, que só desconta se ainda houver saldo: dois vendedores disputando a última unidade nunca deixam o estoque negativo.

Outras decisões que aprendi a defender:
- Histórico de estoque e auditoria que nem o administrador consegue editar ou apagar, garantido por trigger no PostgreSQL
- Três papéis (administrador, gerente e vendedor), cada um vendo só o que deve
- Bloqueio de login por conta, além do limite por IP. Em produção descobri que, atrás da Vercel, a API enxerga o IP do proxy, e o limite por IP sozinho não bastava
- Relatórios por período no fuso horário da loja

Stack: NestJS, TypeScript, PostgreSQL, Prisma, React e Docker, com testes unitários, e2e e de acessibilidade rodando no CI. Deploy na Vercel, no Render e no Neon.

Dá para testar sem cadastro: entre com vendedor.demo@example.com e a senha demo-mini-erp. O primeiro acesso pode demorar um pouco, porque o servidor gratuito "dorme" quando fica sem uso.

Demo: https://mini-erp-estoque-vendas.vercel.app
Código: https://github.com/AndesondaCruz/mini-erp-estoque-vendas

#NestJS #React #PostgreSQL #TypeScript #DesenvolvimentoWeb
