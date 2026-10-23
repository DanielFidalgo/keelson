# One Dockerfile, three images: docker build --build-arg APP=api|worker|demo-server .
#
# The build stage compiles the whole workspace, because every app imports the packages by their
# compiled output. The runtime stage then copies only what one app needs to start.

FROM node:24-slim AS build
WORKDIR /app

COPY . .
RUN npm ci
# Emits dist/ for every package and app; Node runs the compiled JavaScript, never the TypeScript.
RUN npm run typecheck
# Drops devDependencies (the compiler, test tools), so none of them ship in an image.
RUN npm prune --omit=dev

# Declared after the expensive steps so the three images share their cached layers.
ARG APP
RUN mkdir -p /staging/apps \
 && cp -r "apps/${APP}" /staging/apps/ \
 && if [ "${APP}" = "api" ] && [ -d apps/dashboard/dist ]; then \
      mkdir -p /staging/apps/dashboard && cp -r apps/dashboard/dist /staging/apps/dashboard/; \
    fi

FROM node:24-slim AS runtime
ARG APP
# The shell form lets CMD read APP at start-up, which an ARG alone would not provide; exec hands
# SIGTERM to node instead of leaving it with the shell, so Cloud Run can stop the server gracefully.
ENV NODE_ENV=production APP=${APP}
WORKDIR /app

# node_modules links the workspace packages to ./packages, so both are needed side by side.
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /staging/apps ./apps

USER node
CMD exec node apps/$APP/dist/main.js
