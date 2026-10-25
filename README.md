# Clover-X File Share

A self-hosted, multi-user file sharing server with Clover-X branding. Every user gets a private, encrypted space. Users can share files with each other, ask for access, and lock documents with a password. It also supports signing in with a Microsoft account.

It has **zero npm dependencies**: you only need Node.js 18.15 or newer, or Docker.

| | |
|---|---|
| **Accounts** | Local username and password accounts, plus optional Microsoft Entra ID sign-in |
| **Isolation** | Every user has a private folder. Nobody can see anyone else's files unless they were shared with them, and that includes admins |
| **Access requests** | Accounts: people use *Request access* on the sign-in page and an admin approves them.<br>Files: someone opens a link to an item they can't access and presses *Request access*, then the owner approves |
| **Sharing** | Share a file or folder with specific users (view and download only). Folder shares include everything inside |
| **Encryption** | Every file is encrypted at rest with AES-256-GCM and its own key. Video seeking and resumed downloads still work |
| **Document passwords** | Lock any file with a password. The password becomes part of the encryption key, so not even the server can open the file without it |
| **Admin console** | Approve or reject requests, add users, change roles, disable accounts, reset passwords, set up Microsoft sign-in |

## Quick start (Windows / local)

```bash
node server.js
```

You can also double-click `start.bat`. Then open http://localhost:3000.

**First sign-in:** username `Admin`, password `Aman@12@`.
**Change the password immediately** under *Account*. The app shows a warning until you do.

If you used the earlier single-folder version, the files in `shared/` are imported once, encrypted, into the Admin's space. The originals are left in place.

## Configuration

Settings come from environment variables or CLI flags. In Docker, put them in the `.env` file; see `.env.example` for the full annotated list.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port. Without an explicit port, the next free one is used if 3000 is busy |
| `DATA_DIR` | `./data` | Database, encryption key and encrypted files |
| `PUBLIC_URL` | — | Public address, e.g. `https://share.example.com`. Used for the Microsoft redirect URI |
| `TRUST_PROXY` | `0` | Set to `1` behind Caddy, Nginx or an AWS load balancer |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `Admin` / `Aman@12@` | Bootstrap admin, created on first start |
| `RESET_ADMIN` | `0` | Set to `1` for one start to restore the admin account above if you're locked out |
| `ENCRYPTION_KEY` | auto | 32-byte master key (`openssl rand -base64 32`). If empty, a key is generated into `DATA_DIR/secret.key` |
| `MAX_UPLOAD_MB` | `0` | Per-file upload limit (0 = unlimited) |
| `SESSION_DAYS` | `7` | How long a sign-in lasts |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`, `MS_REDIRECT_URI`, `MS_AUTO_APPROVE`, `MS_ALLOWED_DOMAINS` | — | Microsoft sign-in from the environment. Leave these empty to configure it in the admin console instead |

> **Back up `DATA_DIR`, and especially the encryption key.** If the key is lost, the files can't be recovered.

## Microsoft sign-in (Entra ID)

1. In **portal.azure.com**, go to **Microsoft Entra ID → App registrations → New registration**.
2. Name the app *Clover-X File Share*. Under *Supported account types*, choose one:
   - **Single tenant**: only your organisation.
   - **Multitenant + personal accounts**: anyone with a Microsoft account.
3. **Redirect URI:** set the platform to *Web* and the value to `https://YOUR-DOMAIN/auth/microsoft/callback`.
   - The admin console shows the exact value to copy.
   - Microsoft only allows `http://` for `localhost`.
4. From **Overview**, copy the **Application (client) ID** and the **Directory (tenant) ID**.
5. Go to **Certificates & secrets → New client secret** and copy the secret's **Value**.
6. In the app, open **Admin → Sign-in & security → Microsoft sign-in**. Paste the values, switch it on and save.

**Tenant ID** values:
- `common`: any Microsoft account
- `organizations`: any work or school account
- `consumers`: personal accounts only
- your tenant GUID: only your organisation

**New Microsoft users** wait for admin approval unless *Approve automatically* is on. You can also restrict sign-in to email domains, e.g. `clover-x.in`.

## Deploy to AWS (Ubuntu + Docker)

### 1. Launch the server
- **EC2 → Launch instance**: **Ubuntu 24.04 LTS**, `t3.small` or larger, 20 GB or more of storage. More storage means more room for files.
- **Security group:** allow **22** (SSH, your IP only), **80** and **443** (HTTP/HTTPS, anywhere).
- **Static IP:** allocate an **Elastic IP** and associate it with the instance.
- **Domain:** create a DNS **A record**, e.g. `share.clover-x.in`, pointing to that IP. HTTPS needs a domain.

### 2. Install Docker
```bash
ssh -i your-key.pem ubuntu@YOUR-ELASTIC-IP
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker
```

### 3. Copy the app to the server
Use either git:
```bash
git clone https://github.com/YOUR-ACCOUNT/File-Share.git clover-x-share
cd clover-x-share
```
or upload the folder from your PC (PowerShell):
```powershell
scp -i your-key.pem -r "D:\AFTER BCA STUDY\Github-enabled\Clover-X\File-Share" ubuntu@YOUR-ELASTIC-IP:~/clover-x-share
```

### 4. Configure
```bash
cp .env.example .env
nano .env
```
Set at least these:
```ini
DOMAIN=share.clover-x.in
PUBLIC_URL=https://share.clover-x.in
TRUST_PROXY=1
APP_PORT=127.0.0.1:3000
ENCRYPTION_KEY=          # paste the output of: openssl rand -base64 32
ADMIN_PASSWORD=<a strong password>
```
Save a copy of `ENCRYPTION_KEY` somewhere safe outside the server, for example a password manager.

### 5. Start with automatic HTTPS
```bash
docker compose --profile https up -d --build
docker compose logs -f app        # Ctrl+C to stop following
```
Caddy gets a Let's Encrypt certificate automatically. Open `https://share.clover-x.in` and sign in as Admin.

### No domain yet?
You can run plain HTTP on the server's IP for testing:
1. Set `APP_PORT=3000`, `TRUST_PROXY=0` and leave `PUBLIC_URL` empty.
2. Open port **3000** in the security group.
3. Run `docker compose up -d --build` and open `http://YOUR-IP:3000`.

Plain HTTP isn't encrypted in transit, and Microsoft sign-in needs HTTPS.

### Everyday operations
```bash
docker compose ps                                  # status
docker compose logs -f app                         # live log
git pull && docker compose --profile https up -d --build   # update
docker compose --profile https down                # stop

# backup (database + key + encrypted files)
docker run --rm -v clover-x-share_cx-data:/data -v "$PWD":/backup alpine tar czf /backup/cx-backup-$(date +%F).tgz -C /data .

# locked out of Admin? start once with RESET_ADMIN=1, then set it back to 0
```

The volume name is `<folder>_cx-data`. Run `docker volume ls` to check it.

## Security notes

- **Encryption scope:** file **contents** are encrypted. File and folder **names** are stored as plain text on disk.
- **Master key:** whoever holds the master key and the data volume can decrypt files that aren't password-locked. Keep `ENCRYPTION_KEY` out of the data volume (use `.env`) and restrict SSH access.
- **Document passwords:** these can't be recovered. A forgotten password means a lost document.
- **Passwords:** account passwords are hashed with scrypt.
- **Sessions:** signed, HttpOnly cookies. They are revoked when a password changes or an account is disabled.
- **Protections:** login rate limiting, cross-site request blocking, and a strict Content-Security-Policy.

## Project layout

```
server.js            HTTP server, routes, access control
lib/config.js        settings from env / flags
lib/db.js            JSON database (data/db.json)
lib/crypto-store.js  AES-256-GCM chunked file encryption, document passwords
lib/auth.js          password hashing, sessions, Microsoft OIDC
lib/http.js          HTTP helpers
public/              web app (index.html, style.css, app.js)
logo/                Clover-X brand assets
Dockerfile, docker-compose.yml, Caddyfile, .env.example
```
