# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app/server
ENV NODE_ENV=production

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/shared/dist /app/shared/dist
COPY --from=builder /app/shared/package.json /app/shared/package.json
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/drizzle ./drizzle
COPY --from=builder /app/server/package.json ./package.json
COPY --from=builder /app/client/dist ./public

EXPOSE 3000
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
