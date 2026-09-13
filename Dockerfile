FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["node","server.js"]
