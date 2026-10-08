# The call media server: peer-calls (https://github.com/peer-calls/peer-calls,
# Apache-2.0), its Go SFU built on pion, with two small changes for running
# it behind Docker for two phones (loversrock.patch):
#
# - PEERCALLS_NAT1TO1_IPS: the address the phones reach this machine on
#   (its Tailscale IP). Inside a container the server only sees its own
#   bridge address, which no phone can reach.
# - PEERCALLS_WS_ORIGIN_PATTERNS: the app connects from a phone, not from a
#   page this server served, so the origin check is configurable.
# - PEERCALLS_JOIN_SECRET: a room can only be joined with a pass the
#   backend signed for it, so the server carries media only for calls the
#   backend set up (CALLS_SECRET in docker/.env).
#
# Only the server is built: the app is the client (mobile/components/calls/
# sfu.js), so peer-calls' own web page is not needed, and stand-in files take
# the place of the bundle it embeds.
FROM golang:1.22-alpine AS build

RUN apk add --no-cache git

# A fixed commit, so a rebuild is the same server.
ARG PEERCALLS_REPO=https://github.com/peer-calls/peer-calls
ARG PEERCALLS_COMMIT=48bc32669d748171d07d3f70ca39bcf74c05b0d0

RUN git clone "$PEERCALLS_REPO" /src \
 && cd /src \
 && git checkout "$PEERCALLS_COMMIT"

WORKDIR /src
RUN go mod download

COPY loversrock.patch /tmp/loversrock.patch
# A checkout on Windows can give the patch CRLF line endings, which git apply
# rejects ("patch does not apply"): strip them first.
RUN sed -i 's/\r$//' /tmp/loversrock.patch \
 && git apply /tmp/loversrock.patch \
 && mkdir -p build \
 && printf '' > build/index.js \
 && printf '' > build/style.css \
 && CGO_ENABLED=0 go build -mod=readonly -o /peer-calls .

FROM alpine:3.20
COPY --from=build /peer-calls /usr/local/bin/peer-calls
EXPOSE 4100/tcp 4101/tcp
STOPSIGNAL SIGINT
ENTRYPOINT ["/usr/local/bin/peer-calls"]
