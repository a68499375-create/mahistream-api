# Build stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Chromium (alpine) untuk Puppeteer — skip download bundled chrome
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto-emoji 2>/dev/null || apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /usr/src/app

RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont && \
    adduser -D -u 1001 appuser && mkdir -p /usr/src/app/data && chown -R appuser /usr/src/app

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV FLARESOLVERR_URL=http://127.0.0.1:8191/v1

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package*.json ./

RUN npm install --omit=dev

USER appuser

EXPOSE 3001

CMD ["node", "dist/index.js"]
