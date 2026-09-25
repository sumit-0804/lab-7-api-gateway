# API Gateway image. Same pattern as the service Dockerfiles.
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependency files first, so the install layer is cached.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

USER node

# Default port; Compose or the cloud platform can override it through PORT.
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "const p=process.env.PORT||8080;require('http').get('http://127.0.0.1:'+p+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npm", "start"]
