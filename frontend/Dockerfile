# Front-end servido pelo Nginx. Duas etapas: o Node só existe para o build;
# a imagem final leva o HTML/JS/CSS compilado e a configuração do Nginx.

# 1) Build (o "npm run build" roda o tsc antes do vite build)
FROM node:22-alpine AS build
WORKDIR /app
# Mesma versão do npm usada na imagem da API e no CI.
RUN npm install -g npm@11.21.1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 2) Imagem final: Nginx oficial que roda sem root, ouvindo na porta 8080
#    (porta abaixo de 1024 exigiria root).
FROM nginxinc/nginx-unprivileged:1.31-alpine AS runtime
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
