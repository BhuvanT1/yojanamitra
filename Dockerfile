# YojanaMitra — production image.
#
# Three stages so the runtime layer carries no toolchain and no source: install,
# build, then a slim runner on Next's standalone output.
#
# The important decision here is the split between what is baked in and what is
# mounted. The corpus (17MB of normalised schemes plus the provenance record) is
# read-only and identical on every instance, so it is baked into /app/corpus.
# Everything that must survive a redeploy — reviewer and citizen accounts,
# invite codes, clause approvals — lives under /data, which is a volume.
#
# Mounting the volume at /app/data instead (the layout a checkout uses) would
# shadow the baked corpus and the app would boot with zero schemes and no error.
# That is the failure this layout exists to prevent, and /api/health checks for
# it explicitly.

# ---------------------------------------------------------------- dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` needs the dev dependencies: next build runs TypeScript and Tailwind.
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------- build
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --------------------------------------------------------------------- runtime
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    YM_CORPUS_DIR=/app/corpus \
    YM_PROVENANCE_FILE=/app/corpus/provenance.json \
    YM_STATE_DIR=/data

# su-exec drops from root to the app user after the entrypoint has fixed
# ownership on the mounted volume, which arrives owned by root.
RUN apk add --no-cache su-exec \
 && addgroup -S ym && adduser -S -G ym ym

# Next's standalone bundle: server.js plus only the modules actually reached.
COPY --from=builder --chown=ym:ym /app/.next/standalone ./
COPY --from=builder --chown=ym:ym /app/.next/static ./.next/static

# Read-only corpus, baked in.
COPY --from=builder --chown=ym:ym /app/data/normalized/schemes.json ./corpus/schemes.json
COPY --from=builder --chown=ym:ym /app/data/provenance.json ./corpus/provenance.json

# Seed annotations. Copied into the volume on first boot only; after that the
# volume's copy is authoritative, because it holds reviewers' approvals.
COPY --from=builder --chown=ym:ym /app/data/annotations/clauses.json ./seed/annotations/clauses.json

COPY --chown=ym:ym docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

VOLUME ["/data"]
EXPOSE 3000

# Fails the container when the corpus is unreadable, so a platform will not send
# traffic to an instance that would answer every citizen with "nothing matched".
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
