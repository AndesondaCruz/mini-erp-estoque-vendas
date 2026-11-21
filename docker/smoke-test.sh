#!/bin/sh
# Smoke test do ambiente completo do Compose (db + api + web).
# Usado pelo CI e pode ser rodado localmente, na raiz do repositório:
#
#   docker compose up --build --detach --wait
#   docker compose exec -T api node dist/seed-demo.js --reset   # APAGA o banco e cria a demo
#   sh docker/smoke-test.sh
#
# Atenção: as tentativas de login no fim esgotam o rate limit do login
# (5 por minuto) do seu IP por um minuto.
set -e
W=http://localhost:8080
J=$(mktemp)
trap 'rm -f "$J"' EXIT

# Front: SPA, F5 numa rota interna, cabeçalhos de segurança e de cache.
curl --fail --silent $W/ | grep -q '<div id="root">'
curl --fail --silent $W/vendas/123 | grep -q '<div id="root">'
curl --silent --head $W/ | grep -qi "content-security-policy: default-src 'self'"
curl --silent --head $W/ | grep -qi 'cache-control: no-cache'
ASSET=$(curl --silent $W/ | grep -o '/assets/index-[^"]*\.js' | head -1)
curl --silent --head "$W$ASSET" | grep -qi 'cache-control: public, max-age=31536000, immutable'
test "$(curl --silent --output /dev/null --write-out '%{http_code}' $W/assets/nao-existe.js)" = 404

# API pelo Nginx; a porta 3000 não é publicada.
curl --fail --silent $W/api/v1/health | grep -q '"database":"up"'
curl --fail --silent --output /dev/null $W/api/docs
if curl --silent --max-time 3 --output /dev/null http://localhost:3000/api/v1/health; then
  echo "a API não devia responder na porta 3000"; exit 1
fi

# Login e refresh pelo cookie, atravessando o proxy.
# Usa a conta demo (seed-demo.js, senha padrão do Compose).
LOGIN=$(curl --fail --silent --cookie-jar "$J" -X POST $W/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin.demo@example.com","password":"demo-mini-erp"}')
echo "$LOGIN" | grep -q '"role":"ADMIN"'
TOKEN=$(echo "$LOGIN" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
curl --fail --silent --cookie "$J" -X POST $W/api/v1/auth/refresh | grep -q '"accessToken"'

# Dados da demo presentes, e DEMO_MODE protegendo a conta demo.
curl --fail --silent -H "Authorization: Bearer $TOKEN" "$W/api/v1/sales?pageSize=1" | grep -q '"number":'
test "$(curl --silent --output /dev/null --write-out '%{http_code}' -X PATCH $W/api/v1/auth/me/password \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"currentPassword":"demo-mini-erp","newPassword":"outra-senha-forte-123"}')" = 403

# X-Forwarded-For forjado não escapa do rate limit do login (5 por minuto).
LIMITED=no
for i in 1 2 3 4 5 6; do
  CODE=$(curl --silent --output /dev/null --write-out '%{http_code}' -X POST $W/api/v1/auth/login \
    -H "X-Forwarded-For: 203.0.113.$i" -H 'Content-Type: application/json' \
    -d '{"email":"ninguem@mini-erp.local","password":"senha-errada-123"}')
  if [ "$CODE" = 429 ]; then LIMITED=yes; break; fi
done
test "$LIMITED" = yes

test "$(docker compose exec -T web whoami)" = "nginx"
echo "Front, proxy, cache, CSP, cookie de refresh, dados e proteção da demo e rate limit funcionando; web sem root."
