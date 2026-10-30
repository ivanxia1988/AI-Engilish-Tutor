FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV WRANGLER_SEND_METRICS=false
COPY . .
RUN npm ci --no-audit --no-fund && npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    WRANGLER_SEND_METRICS=false
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build /app/scripts/start-railway.mjs /app/scripts/sites-env.mjs /app/scripts/tool-environment.mjs ./scripts/
RUN chown node:node /app
USER node
CMD ["node", "scripts/start-railway.mjs"]
