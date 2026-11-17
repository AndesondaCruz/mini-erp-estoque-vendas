# Build em várias etapas: a imagem final leva só o código compilado
# e as dependências de produção, sem TypeScript, testes ou ferramentas de build.

FROM node:26-alpine AS base
WORKDIR /app
# O Node 22 traz o npm 10, que ignora o campo "allowScripts" do package.json.
# O npm 11 respeita a lista e não executa scripts de instalação não aprovados.
RUN npm install -g npm@11.21.1

# 1) Dependências completas (inclui o CLI do Prisma para gerar o client)
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# 2) Compilação
FROM deps AS build
COPY . .
RUN npm run build

# 3) Só dependências de produção (o client já foi gerado e compilado em dist/)
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# 4) Imagem final
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Nunca rodar como root dentro do container.
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
