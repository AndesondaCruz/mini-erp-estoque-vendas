-- Executado só na primeira vez que o volume do Postgres é criado.
-- Cria um banco separado para os testes e2e, que podem apagar dados à vontade
-- sem tocar no banco de desenvolvimento.
CREATE DATABASE mini_erp_test;
