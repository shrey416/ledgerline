FROM node:24-alpine
WORKDIR /app
COPY package*.json .
RUN npm ci --omit=dev
COPY src src
USER node
EXPOSE 8080
CMD ["npm","start"]
