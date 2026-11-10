# PocketBase for Hugging Face Spaces (Docker SDK)
# HF requires the app to listen on 0.0.0.0:7860.
FROM alpine:3.19

RUN apk add --no-cache ca-certificates unzip wget tzdata

ARG PB_VERSION=0.22.18
ARG PB_ARCH=amd64

RUN wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip \
    && unzip -q pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip \
    && mv pocketbase /usr/local/bin/pocketbase \
    && chmod +x /usr/local/bin/pocketbase \
    && rm -f pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip

WORKDIR /pb

# Schema migrations run automatically on first boot; hooks implement seat
# limits, geofencing and TAT calculation.
COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks
COPY seed_schema.js /pb/seed_schema.js

# Hugging Face Spaces persistent storage (if enabled on the Space) is mounted
# at /data. Fall back to a local folder otherwise.
RUN mkdir -p /pb/pb_data /data/pb_data

EXPOSE 7860

# --dir points at persistent storage when available.
CMD ["sh", "-c", "if [ -d /data ]; then DB=/data/pb_data; else DB=/pb/pb_data; fi; exec pocketbase serve --http=0.0.0.0:7860 --dir=$DB --migrationsDir=/pb/pb_migrations --hooksDir=/pb/pb_hooks"]
