# Collaboration des Esprits (github.com/s-rakim/collaboration-des-esprits,
# MIT), the AI room that replaces Fable. Built from a fixed commit of its
# fcc-2.0 branch, where the room is a chat window for Free Claude Code: the
# models are picked in FCC's own admin page, and every seat talks through it.
#
# One process and one SQLite file (/data/esprits.sqlite, on a volume). It
# listens on every interface inside the container, which Esprits allows only
# with a token: entrypoint.sh makes one on first start if ESPRITS_TOKEN is not
# set, and keeps it in /secret, where the backend reads it too.
FROM node:22-alpine

RUN apk add --no-cache git

ARG ESPRITS_REPO=https://github.com/s-rakim/collaboration-des-esprits
ARG ESPRITS_COMMIT=10a73efa7044e6ee022dc6867773236c1757805e

WORKDIR /app
RUN git clone --branch fcc-2.0 "$ESPRITS_REPO" . \
 && git checkout "$ESPRITS_COMMIT" \
 && npm ci --omit=dev --no-audit --no-fund \
 && rm -rf .git

COPY entrypoint.sh /usr/local/bin/esprits-entrypoint
# A Windows checkout can give the script CRLF line endings, which sh reads as
# part of each command.
RUN sed -i 's/\r$//' /usr/local/bin/esprits-entrypoint && chmod +x /usr/local/bin/esprits-entrypoint

ENV ESPRITS_DB=/data/esprits.sqlite \
    ESPRITS_HOST=0.0.0.0 \
    ESPRITS_PORT=4300 \
    NODE_ENV=production
EXPOSE 4300
ENTRYPOINT ["esprits-entrypoint"]
