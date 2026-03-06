#!/bin/bash
#
# Pavillion Server Provisioning Script
#
# Provisions a fresh Debian server for running Pavillion via Docker Compose.
# Designed to be run once on a brand new server.
#
# Usage (from your local machine):
#   ssh root@your-server 'bash -s' < bin/provision.sh
#   ssh root@your-server 'bash -s -- --staging --domain=staging.example.org' < bin/provision.sh
#
# Or copy to the server and run:
#   scp bin/provision.sh root@your-server:/tmp/
#   ssh root@your-server 'bash /tmp/provision.sh'
#
# Flags:
#   --staging              Enable staging mode (webhook listener, auto-deploy)
#   --domain=<value>       Domain name for the instance (required when piped)
#   --repo=<url>           Git repository URL (default: GitHub repo)
#
# What this script does:
#   1. Creates a 'pavillion' deploy user with sudo access
#   2. Hardens SSH (disables password auth and root login)
#   3. Configures UFW firewall (allows SSH, HTTP, HTTPS)
#   4. Installs Docker CE from official repository
#   5. Adds deploy user to docker group
#   6. Creates application directory at /opt/pavillion
#   7. Clones the repo and runs setup.sh
#   8. (Staging) Configures webhook auto-deploy
#
# Requirements:
#   - Fresh Debian 12 (Bookworm) or later
#   - Root access
#   - Internet connectivity
#
# Security Notes:
#   - After this script runs, root SSH login is disabled
#   - Password authentication is disabled (SSH keys only)
#   - Only ports 22, 80, and 443 are open
#   - The deploy user has passwordless sudo for docker commands
#

set -euo pipefail

# --- Configuration -----------------------------------------------------------

DEPLOY_USER="pavillion"
APP_DIR="/opt/pavillion"
SSH_PORT=22
STAGING_MODE=false
DOMAIN=""
REPO_URL="https://github.com/stephenhoward/pavillion.git"

# --- Colors ------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

print_header() {
  echo -e "\n${BOLD}${BLUE}========================================${NC}"
  echo -e "${BOLD}${BLUE}  Pavillion Server Provisioning${NC}"
  echo -e "${BOLD}${BLUE}========================================${NC}\n"
}

print_step() {
  echo -e "\n${BOLD}${BLUE}--- $1${NC}"
}

print_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# --- Preflight checks --------------------------------------------------------

preflight() {
  if [ "$(id -u)" -ne 0 ]; then
    print_error "This script must be run as root."
    exit 1
  fi

  if ! grep -qi 'debian\|ubuntu' /etc/os-release 2>/dev/null; then
    print_error "This script requires Debian or Ubuntu."
    exit 1
  fi

  # Check for SSH key before we disable password auth
  if [ ! -f /root/.ssh/authorized_keys ] || [ ! -s /root/.ssh/authorized_keys ]; then
    print_error "No SSH authorized_keys found for root."
    print_error "Add your SSH public key before running this script:"
    print_error "  ssh-copy-id root@your-server"
    exit 1
  fi

  # When piped (non-interactive), require --domain flag
  if [ ! -t 0 ] && [ -z "$DOMAIN" ]; then
    print_error "Non-interactive mode detected (piped stdin)."
    print_error "Use --domain=<value> when piping this script:"
    print_error "  ssh root@server 'bash -s -- --domain=example.org' < bin/provision.sh"
    exit 1
  fi
}

# --- Step 1: Create deploy user ----------------------------------------------

create_deploy_user() {
  print_step "Step 1: Creating deploy user '${DEPLOY_USER}'"

  if id "${DEPLOY_USER}" &>/dev/null; then
    print_warning "User '${DEPLOY_USER}' already exists, skipping creation."
  else
    useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
    print_success "Created user '${DEPLOY_USER}'"
  fi

  # Copy root's authorized_keys to deploy user
  mkdir -p "/home/${DEPLOY_USER}/.ssh"
  cp /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
  chmod 700 "/home/${DEPLOY_USER}/.ssh"
  chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  print_success "Copied SSH authorized_keys to '${DEPLOY_USER}'"

  # Grant sudo for docker commands without password
  if [ "$STAGING_MODE" = true ]; then
    cat > "/etc/sudoers.d/${DEPLOY_USER}" << 'EOF'
# Pavillion deploy user: docker and system management (staging)
pavillion ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/docker-compose, /usr/bin/systemctl restart docker, /usr/bin/systemctl status docker, /usr/bin/systemctl restart webhook, /usr/bin/systemctl status webhook, /usr/bin/systemctl start webhook, /usr/bin/journalctl
EOF
  else
    cat > "/etc/sudoers.d/${DEPLOY_USER}" << 'EOF'
# Pavillion deploy user: docker and system management
pavillion ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/docker-compose, /usr/bin/systemctl restart docker, /usr/bin/systemctl status docker, /usr/bin/journalctl
EOF
  fi
  chmod 440 "/etc/sudoers.d/${DEPLOY_USER}"
  print_success "Configured sudo access"
}

# --- Step 2: Harden SSH ------------------------------------------------------

harden_ssh() {
  print_step "Step 2: Hardening SSH"

  local sshd_config="/etc/ssh/sshd_config"

  # Back up original config
  if [ ! -f "${sshd_config}.original" ]; then
    cp "${sshd_config}" "${sshd_config}.original"
    print_success "Backed up original sshd_config"
  fi

  # Apply hardening via drop-in config (cleaner than editing main file)
  cat > /etc/ssh/sshd_config.d/99-pavillion-hardening.conf << EOF
# Pavillion SSH hardening - applied by bin/provision.sh
 PermitRootLogin no
 PasswordAuthentication no
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
MaxAuthTries 3
EOF

  # Validate config before restarting
  if sshd -t 2>/dev/null; then
    systemctl restart sshd
    print_success "SSH hardened: root login disabled, password auth disabled"
  else
    rm /etc/ssh/sshd_config.d/99-pavillion-hardening.conf
    print_error "SSH config validation failed. Hardening was rolled back."
    print_error "SSH is still running with the original configuration."
    exit 1
  fi
}

# --- Step 3: Configure firewall ----------------------------------------------

configure_firewall() {
  print_step "Step 3: Configuring UFW firewall"

  apt-get update -qq
  apt-get install -y -qq ufw > /dev/null

  # Set defaults
  ufw default deny incoming > /dev/null
  ufw default allow outgoing > /dev/null

  # Allow essential ports
  ufw allow "${SSH_PORT}/tcp" > /dev/null
  ufw allow 80/tcp > /dev/null
  ufw allow 443/tcp > /dev/null

  # Staging: allow Docker containers to reach the webhook listener on port 9000
  if [ "$STAGING_MODE" = true ]; then
    ufw allow in on docker0 to any port 9000 > /dev/null
    print_success "Allowed Docker bridge traffic to webhook port 9000"
  fi

  # Enable firewall (--force skips the confirmation prompt)
  ufw --force enable > /dev/null
  print_success "UFW enabled: allowing SSH (${SSH_PORT}), HTTP (80), HTTPS (443)"
}

# --- Step 4: Install Docker ---------------------------------------------------

install_docker() {
  print_step "Step 4: Installing Docker CE"

  if command -v docker &>/dev/null; then
    local docker_version
    docker_version=$(docker --version)
    print_warning "Docker already installed: ${docker_version}"
    print_warning "Skipping Docker installation."
    return
  fi

  # Install prerequisites
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg git > /dev/null

  # Add Docker's official GPG key
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  # Detect distro for correct repo
  local distro
  distro=$(. /etc/os-release && echo "$ID")

  # Add Docker repository
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${distro} \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null

  # Install Docker
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null

  # Enable and start Docker
  systemctl enable docker > /dev/null 2>&1
  systemctl start docker

  print_success "Installed $(docker --version)"
  print_success "Installed Docker Compose $(docker compose version --short)"
}

# --- Step 5: Add deploy user to docker group ----------------------------------

configure_docker_access() {
  print_step "Step 5: Configuring Docker access"

  usermod -aG docker "${DEPLOY_USER}"
  print_success "Added '${DEPLOY_USER}' to docker group"
}

# --- Step 6: Create application directory -------------------------------------

create_app_directory() {
  print_step "Step 6: Creating application directory"

  mkdir -p "${APP_DIR}"
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}"
  print_success "Created ${APP_DIR} (owned by ${DEPLOY_USER})"
}

# --- Step 7 (staging only): Install webhook listener -------------------------

install_webhook() {
  print_step "Step 7: Installing webhook listener (staging mode)"

  apt-get install -y -qq webhook > /dev/null
  print_success "Installed webhook"

  # Create systemd service
  cat > /etc/systemd/system/webhook.service << 'EOF'
[Unit]
Description=Webhook deploy listener
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=pavillion
Group=pavillion
ExecStart=/usr/bin/webhook -hooks /opt/pavillion/hooks.json -ip 0.0.0.0 -port 9000 -verbose
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable webhook > /dev/null 2>&1
  print_success "Created and enabled webhook.service (not started — start after hooks.json is in place)"
}

# --- Clone repo and run setup ------------------------------------------------

clone_and_setup() {
  print_step "Cloning repository and running setup"

  # Prompt for domain interactively if not provided
  if [ -z "$DOMAIN" ]; then
    echo ""
    echo -n "Enter your domain name (e.g., events.example.org): "
    read -r DOMAIN
    if [ -z "$DOMAIN" ]; then
      print_error "Domain name is required."
      exit 1
    fi
  fi

  # Clone the repository as deploy user
  if [ "$(ls -A "${APP_DIR}" 2>/dev/null)" ]; then
    print_warning "${APP_DIR} is not empty, skipping clone."
  else
    if su - "${DEPLOY_USER}" -c "git clone ${REPO_URL} ${APP_DIR}" 2>&1; then
      print_success "Cloned repository to ${APP_DIR}"
    else
      print_error "Failed to clone repository. You will need to clone manually."
      return 1
    fi
  fi

  # Run setup.sh as deploy user
  if [ -f "${APP_DIR}/bin/setup.sh" ]; then
    su - "${DEPLOY_USER}" -c "cd ${APP_DIR} && ./bin/setup.sh --domain=${DOMAIN}"
    print_success "Setup script completed"
  else
    print_error "bin/setup.sh not found in ${APP_DIR}. Run setup manually after cloning."
    return 1
  fi
}

# --- Configure staging auto-deploy ------------------------------------------

configure_staging() {
  print_step "Configuring staging auto-deploy"

  local webhook_secret
  webhook_secret=$(openssl rand -hex 32)

  # Copy deploy script
  if [ -f "${APP_DIR}/docker/staging/deploy.sh" ]; then
    cp "${APP_DIR}/docker/staging/deploy.sh" "${APP_DIR}/deploy.sh"
    chmod 750 "${APP_DIR}/deploy.sh"
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}/deploy.sh"
    print_success "Copied deploy.sh"
  else
    print_error "docker/staging/deploy.sh not found, skipping deploy script."
  fi

  # Copy and configure hooks.json with generated webhook secret
  if [ -f "${APP_DIR}/docker/staging/hooks.json" ]; then
    cp "${APP_DIR}/docker/staging/hooks.json" "${APP_DIR}/hooks.json"
    # Use | as sed delimiter for portability
    sed -i.bak "s|REPLACE_WITH_WEBHOOK_SECRET|${webhook_secret}|" "${APP_DIR}/hooks.json"
    rm -f "${APP_DIR}/hooks.json.bak"
    chmod 600 "${APP_DIR}/hooks.json"
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}/hooks.json"
    print_success "Configured hooks.json with webhook secret"
  else
    print_error "docker/staging/hooks.json not found, skipping webhook config."
  fi

  # Copy staging Caddyfile
  if [ -f "${APP_DIR}/docker/staging/Caddyfile.staging" ]; then
    cp "${APP_DIR}/docker/staging/Caddyfile.staging" "${APP_DIR}/Caddyfile"
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}/Caddyfile"
    print_success "Copied staging Caddyfile"
  else
    print_error "docker/staging/Caddyfile.staging not found, skipping Caddyfile."
  fi

  # Start webhook service
  systemctl start webhook
  print_success "Started webhook service"

  # Store webhook secret for summary display
  WEBHOOK_SECRET="$webhook_secret"
}

# --- Summary ------------------------------------------------------------------

print_summary() {
  local server_ip
  server_ip=$(hostname -I | awk '{print $1}')

  echo ""
  echo -e "${BOLD}${BLUE}========================================${NC}"
  echo -e "${BOLD}${BLUE}  Provisioning Complete${NC}"
  echo -e "${BOLD}${BLUE}========================================${NC}"
  echo ""
  echo -e "${BOLD}What was configured:${NC}"
  echo "  - Deploy user '${DEPLOY_USER}' with SSH key access"
  echo "  - SSH hardened (no root login, no password auth)"
  echo "  - UFW firewall (SSH, HTTP, HTTPS only)"
  echo "  - Docker CE with Compose plugin"
  echo "  - Application directory at ${APP_DIR}"
  echo "  - Repository cloned and secrets generated"
  echo ""
  echo -e "${YELLOW}${BOLD}IMPORTANT: Root SSH is now disabled.${NC}"
  echo -e "${YELLOW}From now on, connect as:${NC}"
  echo -e "${YELLOW}  ssh ${DEPLOY_USER}@${server_ip}${NC}"
  echo ""
  echo -e "${BOLD}Next steps:${NC}"
  echo ""
  echo "  1. Back up your secrets to a password manager"
  echo "     ssh ${DEPLOY_USER}@${server_ip} 'cat ${APP_DIR}/.env'"
  echo ""
  echo "  2. Start Pavillion:"
  echo "     ssh ${DEPLOY_USER}@${server_ip} 'cd ${APP_DIR} && docker compose up -d'"
  echo ""

  if [ "$STAGING_MODE" = true ] && [ -n "${WEBHOOK_SECRET:-}" ]; then
    echo -e "${BOLD}${YELLOW}========================================${NC}"
    echo -e "${BOLD}${YELLOW}  Staging: Webhook Secret${NC}"
    echo -e "${BOLD}${YELLOW}========================================${NC}"
    echo ""
    echo -e "${BOLD}Webhook secret (save this now!):${NC}"
    echo "  ${WEBHOOK_SECRET}"
    echo ""
    echo -e "${BOLD}Add these GitHub secrets (in the 'staging' environment):${NC}"
    echo "  - STAGING_HOST: ${DOMAIN}"
    echo "  - DEPLOY_WEBHOOK_SECRET: ${WEBHOOK_SECRET}"
    echo ""
  fi
}

# --- Main ---------------------------------------------------------------------

main() {
  WEBHOOK_SECRET=""

  for arg in "$@"; do
    case "$arg" in
      --staging) STAGING_MODE=true ;;
      --domain=*) DOMAIN="${arg#--domain=}" ;;
      --repo=*) REPO_URL="${arg#--repo=}" ;;
    esac
  done

  print_header
  preflight
  create_deploy_user
  harden_ssh
  configure_firewall
  install_docker
  configure_docker_access
  create_app_directory

  if [ "$STAGING_MODE" = true ]; then
    install_webhook
  fi

  clone_and_setup || print_warning "Clone/setup had errors — see above. Complete manually if needed."

  if [ "$STAGING_MODE" = true ]; then
    configure_staging || print_warning "Staging configuration had errors — see above."
  fi

  print_summary
}

main "$@"
