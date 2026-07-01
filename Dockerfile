# Use the official Node.js 20 slim image
FROM node:20-slim

# Install system dependencies, including ffmpeg for video rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy the rest of the application files
COPY . .

# Build the frontend assets and compile the server.ts backend to CJS bundle
RUN npm run build

# Prune dev dependencies to keep container size small
RUN npm prune --production

# Expose port 3000
EXPOSE 3000

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Run the backend server
CMD ["npm", "start"]
