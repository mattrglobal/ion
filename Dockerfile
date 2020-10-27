# ---------------------- Builder image ----------------------

FROM node:10.20.1-alpine3.11 AS builder

RUN apk add alpine-sdk python3

WORKDIR /app

COPY . .

RUN npm i

RUN npm run build

RUN rm -rf src/

# ---------------------- Runtime image ----------------------

FROM node:10.20.1-alpine3.11

WORKDIR /app

COPY --from=builder /app .

CMD [ "npm", "start" ]
