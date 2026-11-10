#!/usr/bin/env bash
# =============================================================================
# FieldOps — Oracle Cloud (Ubuntu) one-shot deployment
# =============================================================================
# Kept for when an OCI account (with a payment method) and a custom domain are
# available. For the current no-credit-card / no-domain setup use Hugging Face
# Spaces instead — see deploy_hf.md.
#
# Usage (on your workstation, with the instance SSH key):
#   SSH_HOST=ubuntu@130.61.x.x DOMAIN=api.yourbrand.com ./deploy_oci.sh
# =============================================================================
set -euo pipefail

SSH_HOST="${SSH_HOST:?Set SSH_HOST=ubuntu@<public-ip>}"
DOMAIN="${DOMAIN:?Set DOMAIN=api.yourbrand.com}"
PB_VERSION="${PB_VERSION:-0.22.18}"
REMOTE_DIR="/opt/fieldops"

echo ">> Uploading PocketBase bundle to ${SSH_HOST}:${REMOTE_DIR}"
ssh "${SSH_HOST}" "sudo mkdir -p ${REMOTE_DIR} && sudo chown -R \$USER:\$USER ${REMOTE_DIR}"
scp -r ../pb_hooks ../pb_migrations ../seed_schema.js "${SSH_HOST}:${REMOTE_DIR}/" 2>/dev/null || true

echo ">> Provisioning remote host"
ssh "${SSH_HOST}" bash -s <<REMOTE
set -euo pipefail
cd ${REMOTE_DIR}

ARCH=\$(uname -m)
case "\$ARCH" in
  x86_64|amd64) PB_ARCH=amd64 ;;
  aarch64|arm64) PB_ARCH=arm64 ;;
  *) echo "Unsupported arch \$ARCH"; exit 1 ;;
esac

sudo apt-get update -y
sudo apt-get install -y unzip wget ufw debian-keyring debian-archive-keyring apt-transport-https curl

if [ ! -x "${REMOTE_DIR}/pocketbase" ]; then
  wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_\${PB_ARCH}.zip" -O pb.zip
  unzip -o -q pb.zip && rm pb.zip
  chmod +x pocketbase
fi

# systemd service
sudo tee /etc/systemd/system/pocketbase.service >/dev/null <<UNIT
[Unit]
Description=FieldOps PocketBase
After=network.target

[Service]
Type=simple
User=\$USER
WorkingDirectory=${REMOTE_DIR}
ExecStart=${REMOTE_DIR}/pocketbase serve --http=127.0.0.1:8090 --dir=${REMOTE_DIR}/pb_data --migrationsDir=${REMOTE_DIR}/pb_migrations --hooksDir=${REMOTE_DIR}/pb_hooks
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# Caddy (automatic SSL) reverse proxy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update -y && sudo apt-get install -y caddy

sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
${DOMAIN} {
    reverse_proxy 127.0.0.1:8090
}
CADDY

sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw allow OpenSSH || true

sudo systemctl daemon-reload
sudo systemctl enable --now pocketbase
sudo systemctl restart caddy

echo ">> PocketBase + Caddy running. API: https://${DOMAIN}"
REMOTE

echo ">> Done."
echo "   Next: create the PocketBase superuser and set Cloudflare R2 via the admin UI."
