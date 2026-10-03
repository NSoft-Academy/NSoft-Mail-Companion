FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
ENV INTERNAL_API_URL=http://api:4000
RUN pnpm build
FROM build AS api
USER node
CMD ["pnpm","--filter","@nsoft/api","start"]
FROM build AS worker
USER node
CMD ["pnpm","--filter","@nsoft/worker","start"]
FROM build AS web
USER node
CMD ["pnpm","--filter","@nsoft/web","start"]
FROM build AS migrate
USER node
CMD ["pnpm","db:migrate"]
