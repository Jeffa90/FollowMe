# FollowMe: web + worker image. Build: docker build -t followme .
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates poppler-utils tesseract-ocr fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time placeholders only; real values are injected at runtime.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build SESSION_SECRET=build-time-placeholder-build-time-placeholder AUTH_MODE=entra
RUN npx prisma generate && npm run ext:build && npx next build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN useradd --system --uid 10001 followme && mkdir -p /data/storage && chown -R followme /data /app
COPY --from=build --chown=followme /app ./
USER followme
EXPOSE 3000
# `migrate deploy` is idempotent; the worker uses the same image: `npm run worker`
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p 3000"]
