# PocketBase — generic container for Fly.io / Hugging Face Spaces / VPS.
# - Fly.io: set PORT=8090 (see fly.toml) and mount a volume at /data.
# - Hugging Face Spaces: leave PORT unset (defaults to 7860).
FROM alpine:3.19

RUN apk add --no-cache ca-certificates unzip wget tzdata

# Pin the same PocketBase version the project was built/tested against.
ARG PB_VERSION=0.22.32
ARG PB_ARCH=amd64

RUN wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip \
    && unzip -q pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip \
    && mv pocketbase /usr/local/bin/pocketbase \
    && chmod +x /usr/local/bin/pocketbase \
    && rm -f pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip

WORKDIR /pb

# Schema migrations run automatically on first boot; hooks implement seat
# limits, geofencing, TAT calculation, etc.
COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks

# PORT defaults to 7860 (Hugging Face Spaces). Fly sets PORT=8090 via fly.toml.
ENV PORT=7860

RUN mkdir -p /pb/pb_data

EXPOSE 7860 8090

# Use the persistent volume at /data when present (Fly mount / HF persistent
# storage); otherwise fall back to the container-local folder.
CMD ["sh", "-c", "if [ -d /data ]; then DB=/data/pb_data; else DB=/pb/pb_data; fi; mkdir -p \"$DB\"; exec pocketbase serve --http=0.0.0.0:${PORT:-7860} --dir=\"$DB\" --migrationsDir=/pb/pb_migrations --hooksDir=/pb/pb_hooks"]
