FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache git

RUN git clone https://github.com/ReksioEngine/ReksioEngine.git .

ENV HUSKY=0

RUN corepack enable \
    && yarn install --frozen-lockfile \
    && yarn build

FROM nginx:alpine

COPY --from=build /app/dist/app /usr/share/nginx/html/engine
COPY index.html /usr/share/nginx/html/index.html

EXPOSE 80