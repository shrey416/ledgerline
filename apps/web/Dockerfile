FROM node:24-alpine AS build
WORKDIR /src
COPY package*.json .
RUN npm ci
COPY index.html tsconfig.json vite.config.ts .
COPY apps/web apps/web
RUN npm run build
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/nginx-main.conf /etc/nginx/nginx.conf
EXPOSE 8080
