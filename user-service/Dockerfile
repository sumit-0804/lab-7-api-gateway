# User Service image. Same pattern as the Lab 5 backend Dockerfile.
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependency files first, so the install layer is cached.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

USER node

# Default port; Compose can override it through the PORT environment variable.
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "const p=process.env.PORT||3001;require('http').get('http://127.0.0.1:'+p+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npm", "start"]
