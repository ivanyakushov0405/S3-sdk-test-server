FROM node:22-alpine
RUN apk add --no-cache postgresql18-client
WORKDIR /app
COPY package*.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --omit=dev
RUN npx prisma generate
RUN npm install -g pm2
COPY . .
ENV NODE_ENV=production
EXPOSE 4000
RUN chmod +x /app/docker-entrypoint-migrate-prisma.sh
CMD ["/app/docker-entrypoint.sh"]