# No hay dependencias de npm que instalar: la app solo usa el nucleo de
# Node.js (incluido node:sqlite), asi que la imagen es minima.
FROM node:22-alpine

WORKDIR /app
COPY . .

# La base de datos SQLite y los secretos viven en /app/data, que se monta
# como volumen (ver docker-compose.yml) para que persistan entre reinicios.
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server.js"]
