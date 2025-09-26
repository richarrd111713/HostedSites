# Dockerfile (Node 18 on Alpine - simple & reliable)
FROM node:18-alpine

WORKDIR /app

# Copy package.json (and package-lock.json if present)
COPY package.json package-lock.json* ./

# Install dependencies (uses npm install so lockfile is optional)
# Use --omit=dev to skip dev deps in modern npm
RUN npm install --omit=dev --no-audit --no-fund

# Copy app source
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "ws-proxy.js"]
