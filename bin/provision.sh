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
#   --standalone           Enable the bundled standalone Caddy reverse proxy
#                          (writes COMPOSE_PROFILES=standalone to .env)
#   --domain=<value>       Domain name for the instance (required when piped)
#   --repo=<url>           Git repository URL (default: GitHub repo)
#
# What this script does:
#   1. Configures locale (suppresses perl warnings on fresh Debian)
#   2. Creates a 'pavillion' deploy user with sudo access
#   3. Hardens SSH (disables password auth and root login)
#   4. Configures UFW firewall (allows SSH, HTTP, HTTPS)
#   5. Installs Docker CE from official repository
#   6. Adds deploy user to docker group
#   7. Creates application directory at /opt/pavillion
#   8. Clones the repo
#   9. Creates runtime directories (backups, media storage) with container-user ownership
#  10. Runs bin/deploy.sh to bring up the stack
#  11. (Staging) Configures webhook auto-deploy
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
STANDALONE_MODE=false
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

# --- Fix locale (suppresses perl warnings on fresh Debian) ------------------

configure_locale() {
  if locale 2>&1 | grep -q "Cannot set LC_"; then
    print_step "Configuring locale"
    apt-get update -qq
    apt-get install -y -qq locales > /dev/null
    sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
    locale-gen > /dev/null 2>&1
    update-locale LANG=en_US.UTF-8
    export LANG=en_US.UTF-8
    export LC_ALL=en_US.UTF-8
    print_success "Configured en_US.UTF-8 locale"
  fi
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

  # Pin host pavillion to uid/gid 1001 to match the container's pavillion user
  # (hardcoded in the Dockerfile). With matching uids, bind-mounted runtime
  # files (e.g. /opt/pavillion/backups) appear owned by 'pavillion' on the host
  # rather than by a bare numeric uid, so the host operator can read backups
  # without sudo.
  if id "${DEPLOY_USER}" &>/dev/null; then
    local existing_uid
    existing_uid=$(id -u "${DEPLOY_USER}")
    if [ "${existing_uid}" != "1001" ]; then
      print_warning "User '${DEPLOY_USER}' already exists with uid ${existing_uid} (expected 1001 to match container)."
      print_warning "Bind-mounted runtime files will appear owned by uid 1001, not '${DEPLOY_USER}'."
      print_warning "To remediate manually:"
      print_warning "  usermod -u 1001 ${DEPLOY_USER} && groupmod -g 1001 ${DEPLOY_USER}"
      print_warning "  find /home/${DEPLOY_USER} /opt/pavillion -uid ${existing_uid} -exec chown -h 1001 {} +"
    else
      print_warning "User '${DEPLOY_USER}' already exists with uid 1001, skipping creation."
    fi
  else
    # Refuse to proceed if uid 1001 is taken by a different user, since the
    # container side is hardcoded to that uid and we cannot share it safely.
    if getent passwd 1001 &>/dev/null; then
      local conflict_user
      conflict_user=$(getent passwd 1001 | cut -d: -f1)
      print_error "uid 1001 is already in use by user '${conflict_user}'."
      print_error "The container's pavillion user is hardcoded to uid 1001."
      print_error "Resolve the conflict (e.g. 'userdel ${conflict_user}') and re-run this script."
      exit 1
    fi
    if getent group 1001 &>/dev/null; then
      local conflict_group
      conflict_group=$(getent group 1001 | cut -d: -f1)
      print_error "gid 1001 is already in use by group '${conflict_group}'."
      print_error "The container's pavillion group is hardcoded to gid 1001."
      print_error "Resolve the conflict (e.g. 'groupdel ${conflict_group}') and re-run this script."
      exit 1
    fi
    groupadd --gid 1001 "${DEPLOY_USER}"
    useradd --uid 1001 --gid 1001 --create-home --shell /bin/bash "${DEPLOY_USER}"
    print_success "Created user '${DEPLOY_USER}' (uid/gid 1001, matching container)"
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
  # Use subnet range (172.16.0.0/12) instead of interface name because Docker
  # Compose creates its own bridge (br-<hash>), not the default docker0 bridge.
  if [ "$STAGING_MODE" = true ]; then
    ufw allow from 172.16.0.0/12 to any port 9000 > /dev/null
    print_success "Allowed Docker network traffic to webhook port 9000"
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

# --- Create runtime directories (between clone and docker compose up) --------
#
# These must be created BEFORE bin/deploy.sh runs `docker compose up`, because
# docker-compose.yml bind-mounts /opt/pavillion/backups into the container. If
# the path doesn't exist, Docker auto-creates it as root:root and the worker
# (uid 1001) can't write backup files until something fixes the ownership.

create_runtime_directories() {
  print_step "Creating runtime directories"

  # The container's pavillion user is hardcoded to uid/gid 1001 in the
  # Dockerfile, so runtime directories that the container writes to must be
  # chowned to 1001:1001 on the host.

  # Backups: bind-mounted into the container at /backups via docker-compose.yml.
  mkdir -p "${APP_DIR}/backups"
  chown 1001:1001 "${APP_DIR}/backups"
  chmod 750 "${APP_DIR}/backups"
  print_success "Created ${APP_DIR}/backups (owned by container user uid 1001)"

  # Media storage: used directly by bare-metal deployments. Docker installs use
  # the named 'pavillion-media' volume managed by Docker, but we still create
  # the path so a future bind-mount or bare-metal switch finds it ready, and so
  # operators don't see a half-created tree. Chown both the parent and leaf:
  # mkdir -p creates 'storage/' and 'storage/media/' in one call, but a bare
  # `chown <leaf>` would leave the intermediate directory owned by root.
  mkdir -p "${APP_DIR}/storage/media"
  chown 1001:1001 "${APP_DIR}/storage" "${APP_DIR}/storage/media"
  chmod 750 "${APP_DIR}/storage" "${APP_DIR}/storage/media"
  print_success "Created ${APP_DIR}/storage/media (owned by container user uid 1001)"
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
ExecStart=/usr/bin/webhook -hooks /opt/pavillion/docker/staging/hooks.json -ip 0.0.0.0 -port 9000 -verbose
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

# --- Clone repository --------------------------------------------------------

clone_repo() {
  print_step "Cloning repository"

  # Prompt for domain interactively if not provided. Done here (not later)
  # because clone_repo's empty-directory check must run before any other step
  # populates ${APP_DIR}; gathering the domain at the same time keeps all the
  # interactive prompting in one place.
  if [ -z "$DOMAIN" ]; then
    echo ""
    echo -n "Enter your domain name (e.g., events.example.org): "
    read -r DOMAIN
    if [ -z "$DOMAIN" ]; then
      print_error "Domain name is required."
      exit 1
    fi
  fi

  # The empty-directory check must run before create_runtime_directories,
  # otherwise the runtime subdirs (backups/, storage/) make ${APP_DIR}
  # non-empty and the clone is silently skipped.
  if [ "$(ls -A "${APP_DIR}" 2>/dev/null)" ]; then
    print_warning "${APP_DIR} is not empty, skipping clone."
    return 0
  fi
  if su - "${DEPLOY_USER}" -c "git clone ${REPO_URL} ${APP_DIR}" 2>&1; then
    print_success "Cloned repository to ${APP_DIR}"
  else
    print_error "Failed to clone repository. You will need to clone manually."
    return 1
  fi
}

# --- Run bin/deploy.sh -------------------------------------------------------

run_deploy() {
  print_step "Running bin/deploy.sh"

  if [ ! -f "${APP_DIR}/bin/deploy.sh" ]; then
    print_error "bin/deploy.sh not found in ${APP_DIR}. Run deploy manually after cloning."
    return 1
  fi

  # Prepend COMPOSE_PROFILES so the docker compose calls inside deploy.sh pick
  # up the bundled standalone Caddy. su - strips most env vars (login shell),
  # so the prefix has to live on the command line itself, not the parent env.
  local compose_profiles=""
  if [ "$STANDALONE_MODE" = true ]; then
    compose_profiles="COMPOSE_PROFILES=standalone "
  fi

  su - "${DEPLOY_USER}" -c "cd ${APP_DIR} && ${compose_profiles}./bin/deploy.sh --non-interactive --domain=${DOMAIN}"
  print_success "Deploy script completed"

  # Persist COMPOSE_PROFILES to .env so future docker compose calls (operator
  # running 'docker compose ps', subsequent deploy.sh runs) also see it. .env
  # is created during the install path above, so this append is safe to do
  # after run_deploy succeeds.
  if [ "$STANDALONE_MODE" = true ]; then
    if ! grep -qE '^COMPOSE_PROFILES=' "${APP_DIR}/.env" 2>/dev/null; then
      echo "COMPOSE_PROFILES=standalone" >> "${APP_DIR}/.env"
      print_success "Persisted COMPOSE_PROFILES=standalone to ${APP_DIR}/.env"
    fi
  fi
}

# --- Configure staging auto-deploy ------------------------------------------

configure_staging() {
  print_step "Configuring staging auto-deploy"

  local webhook_secret
  webhook_secret=$(openssl rand -hex 32)

  # Make tracked staging deploy script executable for the webhook user.
  # hooks.json.example points the webhook execute-command directly at
  # docker/staging/deploy.sh, so no copy to ${APP_DIR}/deploy.sh is needed.
  if [ -f "${APP_DIR}/docker/staging/deploy.sh" ]; then
    chmod 750 "${APP_DIR}/docker/staging/deploy.sh"
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}/docker/staging/deploy.sh"
    print_success "Marked docker/staging/deploy.sh executable"
  else
    print_error "docker/staging/deploy.sh not found, skipping deploy script."
  fi

  # Copy hooks.json.example next to itself as hooks.json, then substitute the
  # generated webhook secret in place. The real hooks.json is gitignored.
  if [ -f "${APP_DIR}/docker/staging/hooks.json.example" ]; then
    cp "${APP_DIR}/docker/staging/hooks.json.example" "${APP_DIR}/docker/staging/hooks.json"
    # Use | as sed delimiter for portability
    sed -i.bak "s|REPLACE_WITH_WEBHOOK_SECRET|${webhook_secret}|" "${APP_DIR}/docker/staging/hooks.json"
    rm -f "${APP_DIR}/docker/staging/hooks.json.bak"
    chmod 600 "${APP_DIR}/docker/staging/hooks.json"
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}/docker/staging/hooks.json"
    print_success "Configured docker/staging/hooks.json with webhook secret"
  else
    print_error "docker/staging/hooks.json.example not found, skipping webhook config."
  fi

  # Drop a Caddy snippet into the extras.d extension point so the standalone
  # Caddyfile proxies /hooks/* to the webhook listener on the host. The
  # tracked Caddyfile is left untouched, keeping the working tree clean.
  if [ -d "${APP_DIR}/caddy-extras.d" ]; then
    cat > "${APP_DIR}/caddy-extras.d/hooks.caddyfile" <<'EOF'
handle /hooks/* {
	reverse_proxy host.docker.internal:9000
}
EOF
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}/caddy-extras.d/hooks.caddyfile"
    print_success "Wrote caddy-extras.d/hooks.caddyfile"
  else
    print_error "caddy-extras.d/ not found, skipping Caddy snippet."
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
      --standalone) STANDALONE_MODE=true ;;
      --domain=*) DOMAIN="${arg#--domain=}" ;;
      --repo=*) REPO_URL="${arg#--repo=}" ;;
    esac
  done

  print_header
  preflight
  configure_locale
  create_deploy_user
  harden_ssh
  configure_firewall
  install_docker
  configure_docker_access
  create_app_directory

  if [ "$STAGING_MODE" = true ]; then
    install_webhook
  fi

  # Clone, then create runtime dirs, then deploy. Runtime dirs MUST exist
  # before `docker compose up` runs so Docker doesn't auto-create the
  # /opt/pavillion/backups bind-mount target as root.
  clone_repo || print_warning "Clone had errors — see above. Complete manually if needed."
  create_runtime_directories
  run_deploy || print_warning "Deploy had errors — see above. Complete manually if needed."

  if [ "$STAGING_MODE" = true ]; then
    configure_staging || print_warning "Staging configuration had errors — see above."
  fi

  print_summary
}

main "$@"
