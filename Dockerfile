# syntax=docker/dockerfile:1
# Production image for the Monad Arcade custom server (server.mjs runs Next +
# the /api/ws and /api/bark WebSocket servers). NOT `next start`.

# ---- deps: install the full module tree (server.mjs needs viem/ws, which are
#      transitive deps, so we keep everything rather than pruning) -------------
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile the Next app -------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* is inlined into the browser bundle at build time, so the RPC
# URL must be present HERE, not just at runtime.
ARG NEXT_PUBLIC_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
ENV NEXT_PUBLIC_MONAD_RPC_URL=${NEXT_PUBLIC_MONAD_RPC_URL}
RUN npm run build

# ---- run: the production custom server -------------------------------------
FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Carry the exact build output + module tree. server.mjs reads ./.env and
# ./deployments/contracts.json at runtime; .env is mounted by compose (kept
# OUT of the image so secrets are never baked in).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/deployments ./deployments
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server.mjs ./server.mjs
EXPOSE 3000
CMD ["node", "server.mjs"]
