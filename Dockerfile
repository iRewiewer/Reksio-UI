FROM node:22-alpine AS engine-build

ARG REKSIOENGINE_REPO=https://github.com/ReksioEngine/ReksioEngine.git
ARG REKSIOENGINE_REF=master

WORKDIR /engine

RUN apk add --no-cache git
RUN git clone --depth 1 "${REKSIOENGINE_REPO}" . \
    && git fetch --depth 1 origin "${REKSIOENGINE_REF}" \
    && git checkout FETCH_HEAD

COPY patches/reksioengine-volume.patch /tmp/reksioengine-volume.patch
RUN git apply /tmp/reksioengine-volume.patch

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

COPY --from=app-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY public ./public
COPY --from=engine-build /engine/dist/app ./public/engine

RUN mkdir -p /data \
    && chown -R node:node /data /app

USER node

EXPOSE 3030

CMD ["node", "server.js"]
