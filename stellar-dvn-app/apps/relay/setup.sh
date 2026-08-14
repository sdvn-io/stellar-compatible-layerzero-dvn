#!/bin/bash
set -euo pipefail

SERVICE_NAME="sdvn-relay"
REPO_DIR="git@github.com:sdvn-io/stellar-compatible-layerzero-dvn.git"
APP_DIR="/home/tinkerpal/stellar-compatible-layerzero-dvn/stellar-dvn-app"
RELAY_DIR="/home/tinkerpal/stellar-compatible-layerzero-dvn/stellar-dvn-app/apps/relay"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_FILE="${RELAY_DIR}/.env"

if [ ! -d "$RELAY_DIR" ]; then
  echo "❌ Error: Relay app directory $RELAY_DIR does not exist."
  exit 1
fi

echo "🔄 Pulling latest changes..."
cd "$RELAY_DIR"
git pull origin main || echo "⚠️ Git pull failed or not a git repo, continuing..."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌ pnpm not found. Run: corepack enable && corepack prepare pnpm@11.20.0 --activate"
  exit 1
fi

echo "📦 Ensuring repo-pinned pnpm 11.20.0 is usable..."
PNPM_HOME_V="${PNPM_HOME:-$HOME/.local/share/pnpm}"
PNPM_TOOL="$PNPM_HOME_V/.tools/@pnpm+linux-x64/11.20.0/bin/pnpm"
if [ ! -x "$PNPM_TOOL" ]; then
  echo "⚠️  pnpm 11.20.0 tool missing; repairing..."
  rm -rf "$PNPM_HOME_V/.tools/@pnpm+linux-x64/11.20.0"
  (cd "$APP_DIR" && pnpm --version) || { echo "❌ pnpm repair failed"; exit 1; }
fi
echo "✅ pnpm: $(pnpm --version)"

echo "📦 Installing workspace dependencies..."
cd "$APP_DIR"
pnpm install

echo "🏗️  Building the relay..."
pnpm --filter @stellar-dvn/relay build
if [ ! -f "${RELAY_DIR}/dist/server.js" ]; then
  echo "❌ Build failed: dist/server.js not found."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "${RELAY_DIR}/.env.example" "$ENV_FILE"
  echo "⚠️  Created $ENV_FILE from template."
  echo "   Fill in real values (STELLAR_MESSAGE_OAPP, SEPOLIA_MESSAGE_OAPP, EVM_PRIVATE_KEY, STELLAR_RELAYER_SECRET, scan boundaries), then re-run this script."
  exit 1
fi
chmod 600 "$ENV_FILE"

echo "🔧 Creating systemd service file at $SERVICE_FILE..."
sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=$SERVICE_NAME (Stellar LayerZero DVN relay)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tinkerpal
WorkingDirectory=$RELAY_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env node dist/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

echo "🔄 Reloading systemd and enabling service..."
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}.service

echo "✅ Systemd service '$SERVICE_NAME' has been created and enabled."
read -p "🚀 Do you want to start the app now? (y/n): " choice

if [[ "$choice" =~ ^[Yy]$ ]]; then
  sudo systemctl start ${SERVICE_NAME}.service
  sleep 2
  sudo systemctl status ${SERVICE_NAME}.service
else
  echo "ℹ️ You can start it manually with: sudo systemctl start ${SERVICE_NAME}.service"
fi