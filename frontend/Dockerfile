# syntax=docker/dockerfile:1.28.0
#
# Web image: the built SPA served by unprivileged nginx, which also proxies /api to the API
# container. Build from the repository root:
#   docker build -f frontend/Dockerfile -t sotd-web .

# --- Build: install the locked dependencies and produce dist/ -------------------
FROM node:22.23.3-alpine3.24 AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN corepack enable

# The app imports ../shared/theme-options.json, so shared/ sits next to frontend/.
WORKDIR /src/frontend

COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN --mount=type=cache,id=sotd-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY shared /src/shared
COPY frontend ./
RUN pnpm build

# --- Runtime: static files + reverse proxy, non-root, listening on 8080 ----------
FROM nginxinc/nginx-unprivileged:1.30.5-alpine3.24 AS runtime

USER root
RUN rm -f /etc/nginx/conf.d/default.conf \
    && rm -rf /usr/share/nginx/html/*

COPY frontend/nginx/nginx.conf frontend/nginx/security-headers.conf frontend/nginx/api-proxy.conf \
    /etc/nginx/
COPY --from=build /src/frontend/dist /usr/share/nginx/html

# The image's non-root nginx user.
USER 101

EXPOSE 8080
