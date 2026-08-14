FROM node:20-alpine
WORKDIR /app
COPY bots/discord/package.json ./
RUN npm install --omit=dev
COPY bots/discord/ ./
CMD ["node", "bot.js"]