#!/bin/sh
# Aplica as migrations pendentes e só então inicia a API.
#
# "migrate deploy" só aplica migrations já versionadas em prisma/migrations:
# nunca gera migration nova nem apaga dados (diferente do "migrate dev").
# Se duas instâncias subirem juntas, o Prisma usa um advisory lock do
# Postgres para que só uma aplique as migrations.
set -e

echo "[entrypoint] Aplicando migrations..."
./node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Iniciando a API..."
exec "$@"
