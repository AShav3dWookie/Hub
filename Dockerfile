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

# Baked into the client bundle by Vite, which reads VITE_APP_VERSION at build time
# (client/src/routes/Settings.tsx). It therefore has to be in the environment of the
# `npm run build` below, not the runtime stage. CI passes the released version; a plain
# `docker build` leaves it "dev".
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION

RUN npm run build
RUN npm prune --omit=dev

# npm hoists a dependency to /app/node_modules only while nothing claims a conflicting
# major. A dev dependency wanting zod 4 parks that at the root — where the prune above
# deletes it, correctly, as dev-only — and pushes the server's own zod 3 down into
# server/node_modules. The runtime stage copied only the root, so the image shipped with
# no zod at all and the server died on its first import. The workspace directories are
# copied below; mkdir keeps those COPYs valid on a build that nests nothing.
RUN mkdir -p /app/server/node_modules /app/shared/node_modules

FROM node:22-alpine AS runtime
# ffmpeg: decodes a single poster frame from uploaded videos (see server/src/lib/videoPoster.ts).
RUN apk add --no-cache tini ffmpeg
WORKDIR /app/server
ENV NODE_ENV=production

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/shared/node_modules /app/shared/node_modules
COPY --from=builder /app/shared/dist /app/shared/dist
COPY --from=builder /app/shared/package.json /app/shared/package.json
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/drizzle ./drizzle
COPY --from=builder /app/server/package.json ./package.json
COPY --from=builder /app/client/dist ./public

# A second, independent declaration: ARG does not cross a FROM boundary. Placed after the
# COPYs so that rebuilding for a new version alone reuses every layer above it.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# This stage assembles node_modules by hand, so a dependency npm nested rather than hoisted
# can go missing with nothing to show for it until the server imports it and the container
# crash-loops. Fail the build instead. Existence on the resolution path rather than
# require.resolve: an exports map that does not publish ./package.json would reject a
# package that is really there.
RUN for dep in $(node -p "Object.keys(require('/app/server/package.json').dependencies).join(' ')"); do \
      [ -e "/app/server/node_modules/$dep" ] || [ -e "/app/node_modules/$dep" ] || \
        { echo "missing runtime dependency: $dep"; exit 1; }; \
    done; echo "runtime deps ok"

EXPOSE 3000

# Alpine ships busybox wget, not curl. Shell form so ${PORT} expands at container run time.
# The start period covers runMigrations(), which runs before the server starts listening.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/api/health"

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
