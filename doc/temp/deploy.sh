#!/bin/bash

# Nare Travel Website - VPS Deployment Script
# Builds Docker image locally and deploys directly to VPS
#
# VPS Details:
# - IP: 213.136.80.87
# - User: root
# - Password: dC7Be3(2u2j
# - Domain: berdjds.com

set -e  # Exit on any error

echo "🚀 Nare Travel - VPS Deployment"
echo "=================================================="

# Configuration
IMAGE_NAME="nare-travel:latest"
VPS_IP="213.136.80.87"
VPS_USER="root"
VPS_PATH="/root/productionapp"
TAR_FILE="nare-travel-latest.tar.gz"

# Step 1: Build Docker image for linux/amd64
echo ""
echo "📦 Step 1/4: Building Docker image..."
echo "   Platform: linux/amd64 (VPS compatible)"
echo "   This may take 2-3 minutes..."
docker build --platform=linux/amd64 -t ${IMAGE_NAME} .

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Image built successfully!"

# Step 2: Export Docker image to tar.gz
echo ""
echo "💾 Step 2/4: Exporting Docker image..."
docker save ${IMAGE_NAME} | gzip > ${TAR_FILE}

if [ $? -ne 0 ]; then
    echo "❌ Export failed!"
    exit 1
fi

IMAGE_SIZE=$(du -h ${TAR_FILE} | cut -f1)
echo "✅ Image exported (Size: ${IMAGE_SIZE})"

# Step 3: Upload to VPS
echo ""
echo "📤 Step 3/4: Uploading to VPS..."
echo "   Destination: ${VPS_USER}@${VPS_IP}:/root/"
echo "   Password: dC7Be3(2u2j"
scp ${TAR_FILE} ${VPS_USER}@${VPS_IP}:/root/

if [ $? -ne 0 ]; then
    echo "❌ Upload failed!"
    exit 1
fi

echo "✅ Upload complete!"

# Step 3b: Sync data directory to VPS
echo ""
echo "📁 Step 3b: Syncing data directory to VPS..."
scp -r data ${VPS_USER}@${VPS_IP}:${VPS_PATH}/nare-travel/

if [ $? -ne 0 ]; then
    echo "❌ Data sync failed!"
    exit 1
fi

echo "✅ Data directory synced!"

# Step 4: Deploy on VPS
echo ""
echo "🚢 Step 4/4: Deploying on VPS..."
echo "   Password: dC7Be3(2u2j"

ssh ${VPS_USER}@${VPS_IP} << 'ENDSSH'
cd /root/productionapp

echo "Loading Docker image..."
gunzip -c /root/nare-travel-latest.tar.gz | docker load

echo "Stopping old container..."
docker stop nare-travel 2>/dev/null || true
docker rm nare-travel 2>/dev/null || true

echo "Starting new container..."
docker compose up -d nare-travel

echo "Checking container status..."
docker ps | grep nare-travel

echo ""
echo "✅ Deployment complete!"
ENDSSH

if [ $? -ne 0 ]; then
    echo "❌ Deployment failed!"
    exit 1
fi

# Cleanup
echo ""
echo "🧹 Cleaning up local tar file..."
rm -f ${TAR_FILE}

# Success message
echo ""
echo "=================================================="
echo "✅ DEPLOYMENT SUCCESSFUL!"
echo "=================================================="
echo ""
echo "🌐 Website: https://berdjds.com"
echo "🔧 Admin:   https://berdjds.com/admin/dashboard"
echo ""
echo "📋 Useful Commands:"
echo ""
echo "  View logs:"
echo "    ssh root@${VPS_IP} 'docker logs nare-travel --tail=50'"
echo ""
echo "  Restart container:"
echo "    ssh root@${VPS_IP} 'docker restart nare-travel'"
echo ""
echo "  Container status:"
echo "    ssh root@${VPS_IP} 'docker ps | grep nare-travel'"
echo ""
echo "=================================================="
