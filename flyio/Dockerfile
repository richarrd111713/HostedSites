# Dockerfile (Node 18 on Alpine - small & compatible)
FROM node:18-alpine

# Create app dir
WORKDIR /app

# Copy package files first for better cache usage
COPY package.json package-lock.json* ./

# Install only production deps
RUN npm ci --only=production

# Copy app source
COPY . .

# Expose the port the app will listen on
ENV PORT=8080
EXPOSE 8080

# Start the proxy
CMD ["node", "ws-proxy.js"]
