# The app needs two npm packages at runtime (mammoth and docx, both for
# Word files); everything else it uses is in Node.js itself, including
# SQLite via node:sqlite.
FROM node:22-alpine

WORKDIR /app

# Copied first so the install layer is only rebuilt when the dependencies
# actually change, not on every edit to the app's own source.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# La base de datos SQLite y los secretos viven en /app/data, que se monta
# como volumen (ver docker-compose.yml) para que persistan entre reinicios.
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server.js"]
