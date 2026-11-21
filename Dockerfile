# The mech-royale bot. Build from the repo root: docker build -t mech-royale .
# Matches run it with no network, a read-only root (writable /tmp), 1 CPU, 512 MB, uid 65534, and the map at /arena.
# Node 24 runs the TypeScript sources directly (type stripping); the bot has no npm dependencies.
FROM node:24.22.3-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /bot
COPY package.json ./
COPY bot/ ./bot/
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "--max-old-space-size=384", "/bot/bot/main.ts"]
