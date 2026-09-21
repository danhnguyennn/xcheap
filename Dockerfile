# syntax=docker/dockerfile:1

# ---- 1) Build the frontend (Vite) + bundle the server (esbuild) ----
FROM node:20-alpine AS builder
WORKDIR /app
# package.json only — NOT package-lock.json. The lockfile is committed
# from a non-Linux dev machine, so it never recorded rollup/esbuild's
# linux-musl optional binaries, and npm keeps trusting the lockfile's
# platform resolution even under plain `npm install` (npm/cli#4828) —
# only a lockfile-free install correctly re-resolves optional deps for
# the platform it's actually running on (this Alpine/musl image).
COPY package.json ./
RUN npm install
COPY . .
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
