# Voice interviewer agent image.
#
# BUILD CONTEXT MUST BE THE REPOSITORY ROOT — the worker reuses the backend's
# services/ and lib/ via relative paths (the engine, STT, TTS, and DB pool):
#
#   docker build -f agents/voice-interviewer/Dockerfile -t rekrut-interviewer .
#
# `lk agent create` uploads the same context; see README.md.
FROM node:24-slim

WORKDIR /app

# Install production deps first (layer cache).
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

# The worker's transitive requires (conversation-engine -> interview-ai,
# polsia-ai, ai-provider, db, ...) are all inside these two trees.
COPY services/ ./services/
COPY lib/ ./lib/
COPY agents/voice-interviewer/ ./agents/voice-interviewer/

ENV NODE_ENV=production

CMD ["node", "agents/voice-interviewer/worker.mjs"]
