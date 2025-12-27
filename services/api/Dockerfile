FROM node:20-alpine

WORKDIR /app

# Install sqlite3 for CLI access
RUN apk add --no-cache sqlite curl

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
