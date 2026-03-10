#!/bin/bash
# Coppice.ai — VPS Deployment Script
# Run from the project root on the VPS: bash deploy/deploy.sh

set -e

echo "═══════════════════════════════════════════════"
echo "  Deploying Coppice.ai"
echo "═══════════════════════════════════════════════"

# 1. Landing page
echo "→ Deploying landing page..."
sudo mkdir -p /var/www/coppice-landing
sudo cp landing/index.html /var/www/coppice-landing/index.html

# 2. Frontend build
echo "→ Building frontend..."
cd frontend
npm install --production=false
npx vite build
cd ..

# 3. Backend dependencies
echo "→ Installing backend dependencies..."
cd backend
npm install --production
cd ..

# 4. Nginx config
echo "→ Configuring nginx..."
sudo cp deploy/nginx-coppice.conf /etc/nginx/sites-available/coppice
sudo ln -sf /etc/nginx/sites-available/coppice /etc/nginx/sites-enabled/coppice
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# 5. Backend service (systemd)
echo "→ Setting up backend service..."
sudo tee /etc/systemd/system/coppice-backend.service > /dev/null <<'EOF'
[Unit]
Description=Coppice Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/coppice/backend
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/root/coppice/backend/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable coppice-backend
sudo systemctl restart coppice-backend

echo ""
echo "═══════════════════════════════════════════════"
echo "  Deployment complete!"
echo "  Landing:  https://coppice.ai"
echo "  DACP:     https://dacp.coppice.ai"
echo "  Sangha:   https://sangha.coppice.ai"
echo "═══════════════════════════════════════════════"
