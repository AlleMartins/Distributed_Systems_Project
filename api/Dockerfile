# Utilizziamo Alpine per un'immagine super-leggera
FROM node:20-alpine
WORKDIR /usr/src/app

# Copiamo solo i file di definizione per sfruttare la cache di Docker
COPY package*.json ./
RUN npm ci --only=production

# Copiamo il resto del codice
COPY . .

EXPOSE 3000
CMD ["node", "index.js"]