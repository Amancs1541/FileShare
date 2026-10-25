#!/usr/bin/env bash
#
# Clover-X Personal Management — one-shot installer & manager for Ubuntu / Debian servers (AWS EC2, Lightsail, any VPS).
#
#   ./setup.sh                 install or reconfigure (interactive)
#   ./setup.sh update          pull latest code (git) and rebuild, keeping all data
#   ./setup.sh status          containers, health and URL
#   ./setup.sh logs            follow the logs
#   ./setup.sh backup          archive data volume + .env into ./backups
#   ./setup.sh restart|stop|start
#   ./setup.sh uninstall       remove containers (asks before deleting data)
#
# Non-interactive install:
#   ./setup.sh install --yes --mode sslip --admin-password 'S0mething-Strong'
#   ./setup.sh install --yes --mode domain --domain share.example.com
#   ./setup.sh install --yes --mode http --port 80
#
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"
ENV_FILE="$APP_DIR/.env"
VOLUME="clover-x_cx-data"          # matches "name: clover-x" in docker-compose.yml
DEFAULT_ADMIN_PASSWORD='Aman@12@'

# ---------------------------------------------------------------- output helpers

if [[ -t 1 ]]; then
  B=$'\e[1m'; D=$'\e[2m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; C=$'\e[38;2;79;209;178m'; N=$'\e[0m'
else
  B=''; D=''; R=''; G=''; Y=''; C=''; N=''
fi
info()  { printf '%s\n' "${C}▸${N} $*"; }
ok()    { printf '%s\n' "${G}✔${N} $*"; }
warn()  { printf '%s\n' "${Y}⚠ $*${N}" >&2; }
die()   { printf '%s\n' "${R}✖ $*${N}" >&2; exit 1; }
title() { printf '\n%s\n' "${B}$*${N}"; }
trap 'die "Setup failed at line $LINENO: $BASH_COMMAND"' ERR

banner() {
  printf '\n  %s  %s\n  %s\n' "${C}✤${N}" "${B}Clover-X Personal Management${N}" "${D}setup & management${N}"
}

# ---------------------------------------------------------------- arguments

CMD=install
ASSUME_YES=0
MODE_ARG=''
DOMAIN_ARG=''
PORT_ARG=''
ADMIN_PW_ARG=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    install|update|status|logs|backup|restart|stop|start|uninstall|help) CMD=$1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    --mode) MODE_ARG=${2:-}; shift ;;
    --domain) DOMAIN_ARG=${2:-}; shift ;;
    --port) PORT_ARG=${2:-}; shift ;;
    --admin-password) ADMIN_PW_ARG=${2:-}; shift ;;
    -h|--help) CMD=help ;;
    *) die "Unknown option: $1   (run: ./setup.sh help)" ;;
  esac
  shift
done

# ---------------------------------------------------------------- prompts (work even when piped)

HAVE_TTY=0
if [[ $ASSUME_YES -eq 0 ]] && { : </dev/tty; } 2>/dev/null; then HAVE_TTY=1; fi

# ask VAR "Question" "default" — sets the caller's VAR (helper locals are prefixed so they never shadow it)
ask() {
  local _ask_var=$1 _ask_q=$2 _ask_def=${3:-} _ask_ans=''
  if [[ $HAVE_TTY -eq 1 ]]; then
    read -r -p "  $_ask_q${_ask_def:+ ${D}[$_ask_def]${N}}: " _ask_ans </dev/tty || true
  fi
  printf -v "$_ask_var" '%s' "${_ask_ans:-$_ask_def}"
}

ask_secret() {
  local _sec_var=$1 _sec_q=$2 _sec_ans=''
  if [[ $HAVE_TTY -eq 1 ]]; then
    read -r -s -p "  $_sec_q: " _sec_ans </dev/tty || true
    echo >/dev/tty
  fi
  printf -v "$_sec_var" '%s' "$_sec_ans"
}

confirm() {
  local _confirm_reply
  ask _confirm_reply "$1 (y/n)" "${2:-y}"
  [[ $_confirm_reply =~ ^[Yy] ]]
}

# ---------------------------------------------------------------- environment

SUDO=''
if [[ $EUID -ne 0 ]]; then
  command -v sudo >/dev/null || die "Run as root or install sudo."
  SUDO='sudo'
fi
LOGIN_USER=${SUDO_USER:-${USER:-root}}

dc() { $SUDO docker compose "$@"; }

env_get() {  # read KEY from .env (strips surrounding quotes)
  [[ -f $ENV_FILE ]] || return 0
  { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'$//" -e 's/^"//' -e 's/"$//'
}

volume_exists() { $SUDO docker volume inspect "$VOLUME" >/dev/null 2>&1; }

current_mode() { local m; m=$(env_get CX_MODE); echo "${m:-http}"; }

compose_up() {
  if [[ $(current_mode) == http ]]; then
    dc --profile https rm -sf caddy >/dev/null 2>&1 || true
    dc up -d --build --remove-orphans
  else
    dc --profile https up -d --build --remove-orphans
  fi
}

app_url() {
  local mode port ip
  mode=$(current_mode)
  if [[ $mode != http ]]; then echo "https://$(env_get DOMAIN)"; return; fi
  ip=$(env_get CX_PUBLIC_IP); port=$(env_get APP_PORT); port=${port##*:}
  if [[ $port == 80 ]]; then echo "http://$ip"; else echo "http://$ip:$port"; fi
}

# ---------------------------------------------------------------- system preparation

check_os() {
  [[ -r /etc/os-release ]] || die "Unsupported system (no /etc/os-release)."
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}${ID_LIKE:-}" in
    *ubuntu*|*debian*) ok "System: ${PRETTY_NAME:-$ID}" ;;
    *) warn "Tested on Ubuntu/Debian; detected ${PRETTY_NAME:-unknown}. Continuing anyway." ;;
  esac
  [[ -f $APP_DIR/Dockerfile && -f $APP_DIR/docker-compose.yml ]] || die "Run this script from the Clover-X Personal Management folder (Dockerfile not found in $APP_DIR)."
}

install_prereqs() {
  local missing=()
  for p in curl openssl; do command -v "$p" >/dev/null || missing+=("$p"); done
  if [[ ${#missing[@]} -gt 0 ]]; then
    info "Installing ${missing[*]}…"
    $SUDO apt-get update -qq
    $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates "${missing[@]}" >/dev/null
  fi
}

install_docker() {
  if command -v docker >/dev/null; then
    ok "Docker already installed: $(docker --version | cut -d, -f1)"
  else
    info "Installing Docker Engine (official get.docker.com script)…"
    curl -fsSL https://get.docker.com | $SUDO sh >/dev/null
    ok "Docker installed: $(docker --version | cut -d, -f1)"
  fi
  $SUDO systemctl enable --now docker >/dev/null 2>&1 || true

  if $SUDO docker compose version >/dev/null 2>&1; then
    ok "Docker Compose: $($SUDO docker compose version --short 2>/dev/null || echo plugin)"
  else
    info "Installing the Docker Compose plugin…"
    $SUDO apt-get update -qq
    $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-plugin >/dev/null
    ok "Docker Compose: $($SUDO docker compose version --short)"
  fi

  if [[ $LOGIN_USER != root ]] && ! id -nG "$LOGIN_USER" | grep -qw docker; then
    $SUDO usermod -aG docker "$LOGIN_USER"
    ok "Added $LOGIN_USER to the docker group (takes effect at next login)"
  fi
}

ensure_swap() {
  local mem_mb
  mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if (( mem_mb < 1500 )) && ! swapon --show 2>/dev/null | grep -q .; then
    info "Only ${mem_mb} MB RAM — adding a 1 GB swap file for stability…"
    $SUDO fallocate -l 1G /swapfile 2>/dev/null || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
    $SUDO chmod 600 /swapfile
    $SUDO mkswap /swapfile >/dev/null
    $SUDO swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
    ok "Swap enabled"
  fi
}

detect_public_ip() {
  local token='' ip=''
  # AWS instance metadata (IMDSv2), then generic fallbacks.
  token=$(curl -fsS -m 2 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)
  if [[ -n $token ]]; then
    ip=$(curl -fsS -m 2 -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)
  fi
  [[ $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || ip=$(curl -fsS -m 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)
  [[ $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || ip=$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || true)
  [[ $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && echo "$ip"
}

port_busy() {  # is something other than our containers listening on TCP port $1?
  local port=$1
  $SUDO ss -Hltnp "sport = :$port" 2>/dev/null | grep -v -e docker-proxy -e 'docker' | grep -q .
}

open_firewall() {
  if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q 'Status: active'; then
    for p in "$@"; do $SUDO ufw allow "$p/tcp" >/dev/null; done
    ok "UFW firewall: opened ${*}"
  fi
}

# ---------------------------------------------------------------- configuration

write_env() {
  local mode=$1 domain=$2 public_url=$3 trust=$4 app_port=$5 key=$6 admin_pw=$7 ip=$8
  local ms_id=$9 ms_secret=${10} ms_tenant=${11} ms_auto=${12}
  umask 077
  cat >"$ENV_FILE" <<EOF
# Generated by setup.sh on $(date -u '+%Y-%m-%d %H:%M UTC'). Re-run ./setup.sh to change.
# This file contains the ENCRYPTION KEY — keep a private copy; never commit it.

CX_MODE=$mode
CX_PUBLIC_IP=$ip

DOMAIN=$domain
PUBLIC_URL=$public_url
TRUST_PROXY=$trust
APP_PORT=$app_port

ADMIN_USER=Admin
ADMIN_PASSWORD='$admin_pw'
RESET_ADMIN=0

ENCRYPTION_KEY='$key'

MAX_UPLOAD_MB=0
SESSION_DAYS=7

MS_CLIENT_ID=$ms_id
MS_CLIENT_SECRET='$ms_secret'
MS_TENANT_ID=$ms_tenant
MS_REDIRECT_URI=
MS_AUTO_APPROVE=$ms_auto
MS_ALLOWED_DOMAINS=
EOF
  chmod 600 "$ENV_FILE"
  [[ $LOGIN_USER != root ]] && $SUDO chown "$LOGIN_USER" "$ENV_FILE" 2>/dev/null || true
  ok "Configuration saved to .env"
}

configure() {
  title "1. Address"
  local ip mode domain='' public_url='' trust=1 app_port='127.0.0.1:3000' http_port
  ip=$(detect_public_ip || true)
  if [[ -z $ip ]]; then
    warn "Couldn't detect the public IP automatically."
    ask ip "Public IP of this server" ""
    [[ -n $ip ]] || die "A public IP is required."
  fi
  ok "Public IP: ${B}$ip${N}"
  printf '  %s\n' "${D}Tip: attach an Elastic IP in the AWS console so this address never changes.${N}"

  local sslip="${ip//./-}.sslip.io"
  if [[ -n $MODE_ARG ]]; then
    mode=$MODE_ARG
  else
    printf '\n  How should people reach the server?\n'
    printf '    %s HTTPS with a free name  →  https://%s   %s\n' "${B}1)${N}" "$sslip" "${G}(recommended)${N}"
    printf '    %s HTTPS with my own domain →  https://share.example.com\n' "${B}2)${N}"
    printf '    %s Plain HTTP on the IP     →  http://%s   %s\n' "${B}3)${N}" "$ip" "${D}(no Microsoft sign-in)${N}"
    local choice; ask choice "Choose 1, 2 or 3" "1"
    case "$choice" in 1) mode=sslip ;; 2) mode=domain ;; 3) mode=http ;; *) die "Invalid choice: $choice" ;; esac
  fi

  case "$mode" in
    sslip)
      domain=$sslip
      ;;
    domain)
      domain=$DOMAIN_ARG
      [[ -n $domain ]] || ask domain "Your domain (an A record must point to $ip)" ""
      domain=${domain#http://}; domain=${domain#https://}; domain=${domain%%/*}
      [[ $domain =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "That doesn't look like a domain: $domain"
      local resolved
      resolved=$({ getent ahostsv4 "$domain" 2>/dev/null || true; } | awk 'NR==1 {print $1}')
      if [[ $resolved == "$ip" ]]; then
        ok "DNS check: $domain → $ip"
      else
        warn "DNS check: $domain resolves to '${resolved:-nothing}', not $ip."
        warn "Create an A record '$domain → $ip' first, or the HTTPS certificate will fail."
        confirm "Continue anyway?" n || die "Stopped. Fix DNS and run ./setup.sh again."
      fi
      ;;
    http)
      http_port=${PORT_ARG:-}
      [[ -n $http_port ]] || ask http_port "Port to serve on" "80"
      [[ $http_port =~ ^[0-9]+$ ]] && (( http_port > 0 && http_port < 65536 )) || die "Invalid port: $http_port"
      app_port=$http_port; trust=0
      ;;
    *) die "Unknown mode '$mode' (use sslip, domain or http)" ;;
  esac
  [[ $mode != http ]] && public_url="https://$domain"

  # ---- encryption key: never replace an existing one
  title "2. Encryption"
  local key
  key=$(env_get ENCRYPTION_KEY)
  if [[ -n $key ]]; then
    ok "Keeping the existing encryption key from .env"
  elif volume_exists; then
    ok "Existing data found — keeping the key stored inside the data volume"
  else
    key=$(openssl rand -base64 32)
    ok "Generated a new 256-bit encryption key"
  fi

  # ---- admin password
  title "3. Administrator"
  local admin_pw=$ADMIN_PW_ARG
  if volume_exists; then
    printf '  %s\n' "${D}Existing accounts are kept. The password below only matters for a fresh install or RESET_ADMIN=1.${N}"
  fi
  if [[ -z $admin_pw ]]; then
    local existing; existing=$(env_get ADMIN_PASSWORD)
    if [[ -n $existing && $HAVE_TTY -eq 1 ]] && confirm "Keep the admin password already in .env?" y; then
      admin_pw=$existing
    else
      local again
      while true; do
        ask_secret admin_pw "Admin password (Enter = default ${DEFAULT_ADMIN_PASSWORD})"
        [[ -z $admin_pw ]] && { admin_pw=$DEFAULT_ADMIN_PASSWORD; warn "Using the default password — change it after the first sign-in!"; break; }
        if [[ ${#admin_pw} -lt 8 || ! $admin_pw =~ [A-Za-z] || ! $admin_pw =~ [0-9] ]]; then warn "Use at least 8 characters with letters and numbers."; continue; fi
        [[ $admin_pw == *"'"* ]] && { warn "Please avoid single quotes (')."; continue; }
        ask_secret again "Repeat password"
        [[ $again == "$admin_pw" ]] && break
        warn "Passwords didn't match — try again."
      done
    fi
  fi
  [[ $admin_pw == *"'"* ]] && die "The admin password can't contain single quotes."

  # ---- Microsoft (optional)
  title "4. Microsoft sign-in (optional)"
  local ms_id ms_secret ms_tenant ms_auto
  ms_id=$(env_get MS_CLIENT_ID); ms_secret=$(env_get MS_CLIENT_SECRET); ms_tenant=$(env_get MS_TENANT_ID); ms_auto=$(env_get MS_AUTO_APPROVE)
  ms_tenant=${ms_tenant:-common}; ms_auto=${ms_auto:-0}
  if [[ $mode == http ]]; then
    printf '  %s\n' "${D}Skipped — Microsoft requires HTTPS. Choose option 1 or 2 to use it.${N}"
    ms_id=''; ms_secret=''
  elif [[ -n $ms_id ]] && confirm "Keep the Microsoft settings already in .env (client $ms_id)?" y; then
    :
  elif confirm "Set it up now? (you can also do it later in Admin → Sign-in & security)" n; then
    printf '\n  In Azure (portal.azure.com → Microsoft Entra ID → App registrations), use this redirect URI (platform: Web):\n'
    printf '    %s\n\n' "${B}https://$domain/auth/microsoft/callback${N}"
    ask ms_id "Application (client) ID" "$ms_id"
    ask_secret ms_secret "Client secret value"
    ask ms_tenant "Tenant ID (common / organizations / your tenant GUID)" "$ms_tenant"
    confirm "Let new Microsoft users in without admin approval?" n && ms_auto=1 || ms_auto=0
    [[ $ms_secret == *"'"* ]] && die "The client secret can't contain single quotes."
  else
    ms_id=''; ms_secret=''
    printf '  %s\n' "${D}Skipped.${N}"
  fi

  write_env "$mode" "$domain" "$public_url" "$trust" "$app_port" "$key" "$admin_pw" "$ip" "$ms_id" "$ms_secret" "$ms_tenant" "$ms_auto"
}

# ---------------------------------------------------------------- deploy & verify

preflight_ports() {
  local mode; mode=$(current_mode)
  local ports=()
  if [[ $mode == http ]]; then ports=("$(env_get APP_PORT)"); else ports=(80 443); fi
  for p in "${ports[@]}"; do
    if port_busy "$p"; then
      warn "Port $p is already used by another program:"
      $SUDO ss -Hltnp "sport = :$p" | sed 's/^/      /' >&2
      die "Free port $p (e.g. sudo systemctl disable --now nginx apache2) and run ./setup.sh again."
    fi
  done
  open_firewall "${ports[@]}"
}

wait_healthy() {
  info "Waiting for the app to start…"
  for _ in $(seq 1 45); do
    if dc exec -T app wget -qO- http://127.0.0.1:3000/healthz 2>/dev/null | grep -q ok; then ok "App is healthy"; return 0; fi
    sleep 2
  done
  dc logs --tail 40 app >&2 || true
  die "The app didn't become healthy. See the log above."
}

check_public() {
  local url; url=$(app_url)
  if [[ $(current_mode) != http ]]; then
    info "Getting an HTTPS certificate for $(env_get DOMAIN) (can take up to a minute)…"
    for _ in $(seq 1 30); do
      if curl -fsS -m 5 "$url/healthz" 2>/dev/null | grep -q ok; then ok "Reachable over HTTPS: $url"; return 0; fi
      sleep 3
    done
    warn "Couldn't reach $url from the internet yet."
    warn "Most likely the AWS Security Group doesn't allow inbound TCP 80 and 443 from 0.0.0.0/0."
    warn "EC2 → Instances → your instance → Security → Security groups → Edit inbound rules."
    dc logs --tail 15 caddy >&2 || true
  else
    for _ in $(seq 1 5); do
      if curl -fsS -m 5 "$url/healthz" 2>/dev/null | grep -q ok; then ok "Reachable: $url"; return 0; fi
      sleep 2
    done
    warn "Couldn't reach $url from the internet."
    warn "Allow inbound TCP $(env_get APP_PORT) in the AWS Security Group (EC2 → Security groups → Edit inbound rules)."
  fi
}

summary() {
  local url admin_pw key_note
  url=$(app_url)
  admin_pw=$(env_get ADMIN_PASSWORD)
  if [[ -n $(env_get ENCRYPTION_KEY) ]]; then key_note="ENCRYPTION_KEY in $ENV_FILE"; else key_note="secret.key inside the '$VOLUME' Docker volume"; fi
  printf '\n%s\n' "${C}────────────────────────────────────────────────────────────${N}"
  printf '  %s  %s\n\n' "${C}✤${N}" "${B}Clover-X Personal Management is live${N}"
  printf '     Open:       %s\n' "${B}${C}$url${N}"
  printf '     Sign in:    %s\n' "${B}Admin${N} / $( [[ $admin_pw == "$DEFAULT_ADMIN_PASSWORD" ]] && echo "$DEFAULT_ADMIN_PASSWORD ${Y}(default — change it!)${N}" || echo 'the password you chose')"
  [[ $(current_mode) != http ]] && printf '     Microsoft:  redirect URI %s\n' "$url/auth/microsoft/callback"
  printf '\n     %s\n' "${Y}Back up the encryption key:${N} $key_note"
  printf '     %s\n' "${D}Without it the files can't be decrypted. Run ./setup.sh backup regularly.${N}"
  printf '\n     Manage:  ./setup.sh status | logs | update | backup | restart | stop\n'
  printf '%s\n\n' "${C}────────────────────────────────────────────────────────────${N}"
}

# ---------------------------------------------------------------- commands

cmd_install() {
  banner
  title "Preparing the server"
  check_os
  install_prereqs
  install_docker
  ensure_swap

  if [[ -f $ENV_FILE && -n $(env_get CX_MODE) ]] && [[ -z $MODE_ARG ]] && confirm "Existing setup found ($(app_url)). Keep it and just redeploy?" y; then
    ok "Keeping current configuration"
  else
    configure
  fi

  title "Starting"
  preflight_ports
  info "Building and starting containers…"
  compose_up
  wait_healthy
  check_public
  summary
}

cmd_update() {
  banner
  [[ -f $ENV_FILE ]] || die "Not installed yet — run ./setup.sh first."
  if [[ -d .git ]] && command -v git >/dev/null; then
    if [[ -z $(git status --porcelain --untracked-files=no) ]]; then
      info "Pulling the latest code…"
      git pull --ff-only
    else
      warn "Local code changes found — skipping git pull, rebuilding what's here."
    fi
  fi
  info "Rebuilding (your data is kept)…"
  compose_up
  $SUDO docker image prune -f >/dev/null 2>&1 || true
  wait_healthy
  ok "Updated: $(app_url)"
}

cmd_status() {
  [[ -f $ENV_FILE ]] || die "Not installed yet — run ./setup.sh first."
  dc --profile https ps
  echo
  if dc exec -T app wget -qO- http://127.0.0.1:3000/healthz 2>/dev/null | grep -q ok; then ok "App healthy"; else warn "App not responding"; fi
  printf '  URL:  %s\n' "$(app_url)"
  printf '  Data: %s\n' "$($SUDO docker system df -v 2>/dev/null | awk -v v="$VOLUME" '$1==v {print $NF}' || true) in volume $VOLUME"
}

cmd_backup() {
  [[ -f $ENV_FILE ]] || die "Not installed yet — run ./setup.sh first."
  volume_exists || die "No data volume ($VOLUME) found."
  local stamp dir
  stamp=$(date +%Y%m%d-%H%M%S)
  dir="$APP_DIR/backups"
  mkdir -p "$dir"
  info "Archiving data volume…"
  $SUDO docker run --rm -v "$VOLUME":/data:ro -v "$dir":/backup alpine tar czf "/backup/cx-data-$stamp.tgz" -C /data .
  cp "$ENV_FILE" "$dir/env-$stamp"
  $SUDO chmod 600 "$dir/cx-data-$stamp.tgz" "$dir/env-$stamp"
  [[ $LOGIN_USER != root ]] && $SUDO chown "$LOGIN_USER" "$dir"/* 2>/dev/null || true
  ok "Backup written:"
  ls -lh "$dir/cx-data-$stamp.tgz" "$dir/env-$stamp" | sed 's/^/    /'
  printf '  %s\n' "${D}Copy both files off the server, e.g.:  scp -i key.pem ubuntu@SERVER:~/clover-x-share/backups/*$stamp* .${N}"
  printf '  %s\n' "${D}Restore: docker run --rm -v $VOLUME:/data -v \$PWD/backups:/backup alpine tar xzf /backup/cx-data-$stamp.tgz -C /data${N}"
}

cmd_uninstall() {
  banner
  confirm "Stop and remove the Clover-X containers?" n || exit 0
  dc --profile https down --remove-orphans
  ok "Containers removed"
  if volume_exists; then
    warn "The data volume '$VOLUME' still holds all users and files."
    local typed=''
    ask typed "Type DELETE to erase it permanently (anything else keeps it)" ""
    if [[ $typed == DELETE ]]; then
      $SUDO docker volume rm "$VOLUME" clover-x_caddy-data clover-x_caddy-config >/dev/null 2>&1 || true
      ok "Data deleted"
    else
      ok "Data kept — run ./setup.sh to bring it back"
    fi
  fi
}

cmd_help() {
  sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'
}

case "$CMD" in
  install)   cmd_install ;;
  update)    cmd_update ;;
  status)    cmd_status ;;
  logs)      dc --profile https logs -f --tail 100 ;;
  backup)    cmd_backup ;;
  restart)   dc --profile https restart && ok "Restarted" ;;
  stop)      dc --profile https stop && ok "Stopped" ;;
  start)     compose_up && wait_healthy && ok "Running: $(app_url)" ;;
  uninstall) cmd_uninstall ;;
  help)      cmd_help ;;
esac
