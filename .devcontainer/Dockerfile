# Dev-container image for Logger. Development happens *inside* this — it carries the exact
# toolchain every machine needs (Node 22, ffmpeg, sqlite3, Playwright + Chromium) so problems
# like "ffmpeg is not installed" or a drifted host Node version can't happen.
#
# This is deliberately NOT the production base. Prod is node:22-alpine (see ../Dockerfile);
# this is Debian because Playwright's browsers are unsupported on musl and the VS Code server
# + extensions are smoother on glibc. `npm run docker:test` against the real alpine image
# (from a host terminal) stays the backstop for musl-specific native-module issues.
FROM mcr.microsoft.com/devcontainers/typescript-node:22-bookworm

# Linux tools the app and its tests shell out to.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ffmpeg \
      sqlite3 \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Playwright browsers + their system libraries, baked into the image at a fixed path owned by
# the `node` user (so `npx playwright install` reconciles from postCreate can write there).
# Two installs: the repo's pinned Playwright (for `npm run test:e2e`) and the newer line the
# Playwright MCP bundles — cheap disk, removes every version-alignment failure mode.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx --yes playwright@1.62.1 install --with-deps chromium \
 && npx --yes @playwright/mcp@0.0.80 install-browser chromium \
 && chown -R node:node /ms-playwright
