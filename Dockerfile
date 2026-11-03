FROM node:22-alpine

WORKDIR /app

# FFmpeg: quadros, áudio para transcrição e cortes verticais (src/services/media.js)
RUN apk add --no-cache ffmpeg

COPY package.json package-lock.json ./
# O npm às vezes escolhe o binário "gnu" em vez do "musl" no Alpine (canvas); --libc=musl força o certo e a checagem abaixo derruba o build se faltar
RUN npm ci --omit=dev --libc=musl && node -e "require(\"@napi-rs/canvas\")"

COPY src ./src
# Miniaturas da galeria (volume "previews" no docker-compose): a pasta já nasce do usuário node
RUN mkdir -p /app/data/previews && chown -R node:node /app/data

ENV NODE_ENV=production
EXPOSE 3100

# Roda sem root
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
