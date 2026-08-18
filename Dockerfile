FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY src ./src
COPY migrations ./migrations
EXPOSE 3000
CMD ["sh","-c","node src/migrate.js && node src/server.js"]
