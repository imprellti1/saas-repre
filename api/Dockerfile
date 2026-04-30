FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# fallback para prisma não quebrar se o painel não injetar env em alguma fase
ARG DATABASE_URL=postgresql://postgres:postgres@postgres-neuralhire:5432/neuralhire?schema=public
ENV DATABASE_URL=${DATABASE_URL}

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["sh", "-c", "npx prisma generate && npx prisma db push --accept-data-loss && node src/server.js"]
