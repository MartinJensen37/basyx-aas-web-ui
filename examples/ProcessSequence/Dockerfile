# Build the current checkout for the Process Sequence demo.
# Normalize Windows shell-script line endings in the image. Run lint, type checks,
# and relevant tests on the host; build-only avoids unrelated CRLF lint failures.
FROM --platform=$BUILDPLATFORM node:24-slim AS build-stage
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NODE_OPTIONS=--max-old-space-size=8192
ARG VITE_APP_VERSION
ARG VITE_APP_COMMIT_SHA
ARG VITE_APP_BUILD_DATE
ENV NODE_OPTIONS=$NODE_OPTIONS
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_APP_COMMIT_SHA=$VITE_APP_COMMIT_SHA
ENV VITE_APP_BUILD_DATE=$VITE_APP_BUILD_DATE
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts ./scripts
RUN corepack enable
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm build-only
RUN pnpm bff:build

FROM node:24-slim AS edc-bff-stage
ARG HTTP_PROXY
ARG HTTPS_PROXY
WORKDIR /usr/src/app
ENV NODE_ENV=production
ENV CX_EDC_BFF_PORT=3001
COPY --from=build-stage /app/dist-bff /usr/src/app/dist-bff
EXPOSE 3001
CMD ["node", "/usr/src/app/dist-bff/edc-bff/server.js"]

FROM nginx:mainline-alpine-slim AS production-stage
ARG HTTP_PROXY
ARG HTTPS_PROXY
WORKDIR /usr/src/app
RUN apk add --no-cache jq gettext 'nodejs~24'
RUN addgroup -g 1000 -S mygroup && \
  adduser -u 1000 -D -S -G mygroup myuser
COPY --from=build-stage /app/dist /usr/src/app/dist
COPY --from=build-stage /app/dist-bff /usr/src/app/dist-bff
COPY nginx.conf /etc/nginx/nginx.conf.template
COPY entrypoint.sh /usr/src/app/entrypoint.sh
RUN sed -i 's/\r$//' /etc/nginx/nginx.conf.template /usr/src/app/entrypoint.sh && \
  chmod +x /usr/src/app/entrypoint.sh
RUN chown -R myuser:mygroup /usr/src/app /var/cache/nginx /tmp /etc/nginx /usr/share/nginx/html
RUN chmod -R 777 /usr/src/app /var/cache/nginx /tmp /etc/nginx
USER myuser
ENTRYPOINT ["/usr/src/app/entrypoint.sh"]
