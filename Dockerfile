FROM node:22-alpine AS engine-build

WORKDIR /engine

COPY ReksioEngine ./

ENV HUSKY=0

RUN corepack enable \
    && yarn install --frozen-lockfile \
    && yarn build

FROM node:22-alpine AS app-deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3030
ENV REKSIO_DATA_DIR=/data

RUN apk add --no-cache su-exec

COPY --from=app-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY public ./public
COPY --from=engine-build /engine/dist/app ./public/engine
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && chown -R node:node /data /app

EXPOSE 3030

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
