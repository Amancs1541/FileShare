# Clover-X File Share — zero npm dependencies, so the image is just Node + the app.
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app

COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
COPY logo ./logo

# Run as the unprivileged "node" user; /data holds the database, the encryption key and all files.
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
