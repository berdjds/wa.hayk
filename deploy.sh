#!/bin/bash

# WAControl - VPS Deployment Script
# Packages the source code, uploads it to the VPS, builds the Docker image there,
# and deploys it via the existing docker-compose.yml.
#
# Usage:
#   ./deploy-vps.sh
#
# VPS Details:
# - IP: 213.136.80.87
# - User: root
# - Domain: wa.hayk.ae

set -e  # Exit on any error

echo "🚀 WAControl - VPS Deployment"
echo "=================================================="

# Configuration
SOURCE_TAR="wacontrol-source.tar.gz"
VPS_IP="213.136.80.87"
VPS_USER="root"
VPS_PATH="/root/productionapp"
SSH_KEY="${HOME}/.ssh/wacontrol_deploy"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

# Step 1: Package source code
echo ""
echo "📦 Step 1/3: Packaging source code..."
tar \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='.wwebjs_auth' \
  --exclude='.wwebjs_cache' \
  --exclude='public/uploads' \
  --exclude='prisma/dev.db' \
  --exclude='*.tar.gz' \
  --exclude='*.db-journal' \
  -czf "${SOURCE_TAR}" .

TAR_SIZE=$(du -h "${SOURCE_TAR}" | cut -f1)
echo "✅ Source packaged (Size: ${TAR_SIZE})"

# Step 2: Upload source to VPS
echo ""
echo "📤 Step 2/3: Uploading source to VPS..."
echo "   Destination: ${VPS_USER}@${VPS_IP}:/tmp/"
scp ${SSH_OPTS} -i "${SSH_KEY}" "${SOURCE_TAR}" ${VPS_USER}@${VPS_IP}:/tmp/

if [ $? -ne 0 ]; then
    echo "❌ Upload failed!"
    exit 1
fi

echo "✅ Upload complete!"

# Step 3: Build image and deploy on VPS
echo ""
echo "🚢 Step 3/3: Building and deploying on VPS..."

RUN_DEPLOY=$(cat <<'ENDSSH'
set -e

cd /root/productionapp

echo "Extracting source code..."
mkdir -p wacontrol-src
rm -rf wacontrol-src/*
tar -xzf /tmp/wacontrol-source.tar.gz -C wacontrol-src

echo "Building Docker image..."
cd wacontrol-src
docker build -t wacontrol:latest .

echo "Creating persistence directories..."
cd /root/productionapp
mkdir -p wacontrol-data wacontrol-uploads wacontrol-auth

echo "Stopping old container..."
docker stop wacontrol-app 2>/dev/null || true
docker rm wacontrol-app 2>/dev/null || true

echo "Starting container..."
docker compose up -d wacontrol_app

echo "Seeding admin user..."
docker compose exec wacontrol_app npm run db:seed || true

echo "Checking container status..."
docker ps | grep wacontrol-app

echo ""
echo "✅ Deployment complete!"
ENDSSH
)

ssh ${SSH_OPTS} -i "${SSH_KEY}" ${VPS_USER}@${VPS_IP} "${RUN_DEPLOY}"

if [ $? -ne 0 ]; then
    echo "❌ Deployment failed!"
    exit 1
fi

# Cleanup
echo ""
echo "🧹 Cleaning up local tar file..."
rm -f "${SOURCE_TAR}"

# Success message
echo ""
echo "=================================================="
echo "✅ DEPLOYMENT SUCCESSFUL!"
echo "=================================================="
echo ""
echo "🌐 Website: https://wa.hayk.ae"
echo "🔧 Login:   https://wa.hayk.ae/login"
echo ""
echo "📋 Useful Commands:"
echo ""
echo "  View logs:"
echo "    ssh root@${VPS_IP} -i ${SSH_KEY} 'docker logs wacontrol-app --tail=50'"
echo ""
echo "  Restart container:"
echo "    ssh root@${VPS_IP} -i ${SSH_KEY} 'docker restart wacontrol-app'"
echo ""
echo "  Container status:"
echo "    ssh root@${VPS_IP} -i ${SSH_KEY} 'docker ps | grep wacontrol-app'"
echo ""
echo "=================================================="
