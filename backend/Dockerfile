FROM node:22-alpine

# ffmpeg: the voice-note effects (src/models/voiceFilters.js).
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4000

CMD ["node", "src/server.js"]
