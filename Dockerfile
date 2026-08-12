FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=25774
ENV DATA_DIR=/data
EXPOSE 25774

CMD ["sh", "entrypoint.sh"]
