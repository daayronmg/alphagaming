# ESTRELLA · imagen de producción (API + WebSocket + PWA en un único servicio)
FROM node:22.22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared shared
COPY server server
COPY web web
RUN npm run build -w web

FROM node:22.22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4000 STORAGE_DIR=/data/storage WEB_DIST=/app/web/dist
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY shared shared
COPY server server
COPY --from=build /app/web/dist web/dist
WORKDIR /app/server
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
EXPOSE 4000
CMD ["node", "src/index.ts"]
