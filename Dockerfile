# syntax=docker/dockerfile:1

# ---- 1) Build the frontend (Vite) + bundle the server (esbuild) ----
FROM node:20-alpine AS builder
WORKDIR /app
# package-lock.json must be regenerated (`npm install`) inside a
# node:20-alpine container, never on a dev machine — a lockfile
# generated elsewhere never records rollup/esbuild's linux-musl
# optional binaries, which makes `npm ci` fail here with "Cannot find
# module @rollup/rollup-linux-x64-musl" (npm/cli#4828).
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite only bakes VITE_* vars into the built JS at build time — .env is
# excluded from the build context on purpose (.dockerignore), so this
# has to come in as a build ARG instead, passed from docker-compose.yml.
ARG VITE_TURNSTILE_SITE_KEY
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
RUN npm run build

# ---- 2) Install production-only dependencies (no devDependencies) ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- 3) Minimal runtime image ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
USER app
EXPOSE 3434
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://127.0.0.1:3434/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/server.cjs"]
