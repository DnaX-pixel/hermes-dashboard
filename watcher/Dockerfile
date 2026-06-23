FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV DATA_ROOT=/opt/data
ENV PORT=4500

EXPOSE 4500

CMD ["node", "index.js"]
