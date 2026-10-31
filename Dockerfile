FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm ci --no-audit --no-fund && npm run build:node

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TEEKO_NODE_RUNTIME=1 \
    LITTLELEAF_HOSTING=railway
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next-node ./.next-node
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts /app/tsconfig.json /app/tsconfig.node.json ./
COPY --from=build /app/db ./db
COPY --from=build /app/lib ./lib
COPY --from=build /app/scripts ./scripts
RUN chown node:node /app
USER node
CMD ["node", "scripts/run-node-framework.mjs", "start"]
