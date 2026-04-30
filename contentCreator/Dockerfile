# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Stage 1: Build the Vite SPA
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build
COPY . .

# No secrets are baked in at build time any more — LLM API keys live in the
# backend proxy (see ./server). The SPA talks to it via /api/*.
RUN npm run build


# -----------------------------------------------------------------------------
# Stage 2: Serve static assets with nginx
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# Replace default config with our SPA-friendly one
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# nginx's default CMD already starts the server in the foreground
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
