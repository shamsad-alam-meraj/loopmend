#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 ARM64 (Oracle Cloud Always Free) VM.
# Also open TCP 80/443 in the VCN security list. Run as a sudo-capable user.
set -euo pipefail
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable
# Oracle images ship iptables rules that can bypass ufw for 80/443 — make sure they allow it:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
sudo netfilter-persistent save 2>/dev/null || true

sudo dpkg-reconfigure -f noninteractive unattended-upgrades
echo "Log out and back in (docker group), then: cd infrastructure/docker && cp .env.example .env && docker compose up -d"
