# Clover-X Personal Management

A self-hosted, multi-user file sharing server and password manager with Clover-X branding. Every user gets a private, encrypted space and their own password vault. Users can share files with each other, ask for access, and lock documents with a password. It also supports signing in with a Microsoft account.

It has **zero npm dependencies**: you only need Node.js 18.15 or newer, or Docker.

| | |
|---|---|
| **Accounts** | Local username and password accounts, plus optional Microsoft Entra ID sign-in |
| **Isolation** | Every user has a private folder. Nobody can see anyone else's files unless they were shared with them, and that includes admins |
| **Access requests** | Accounts: people use *Request access* on the sign-in page and an admin approves them.<br>Files: someone opens a link to an item they can't access and presses *Request access*, then the owner approves |
| **Sharing** | Share a file or folder with specific users (view and download only). Folder shares include everything inside |
| **Encryption** | Every file is encrypted at rest with AES-256-GCM and its own key. Video seeking and resumed downloads still work |
| **Document passwords** | Lock any file with a password. The password becomes part of the encryption key, so not even the server can open the file without it |
| **Password manager** | A personal vault for logins and secure notes, with a password generator, strength meter, weak/reused/old password checks, folders, favorites, and CSV import/export |
| **Documents** | Clover-X branded letterheads, documents, meeting minutes, envelopes, business cards and email signatures with a live preview, print or save as PDF, download as HTML, or save to My files |
| **Admin console** | Approve or reject requests, add users, change roles, disable accounts, reset passwords, set up Microsoft sign-in |

## Password manager

Open **Passwords** in the sidebar. The first time, you choose a **vault password**. It is separate from your sign-in password, and Microsoft users need one too.

- **Encryption:** the whole vault is encrypted with AES-256-GCM. The key is derived from the server key **and** your vault password, which is never stored.
  - This means administrators and the server itself can't read it.
  - A forgotten vault password can't be recovered. *Forgot your vault password?* deletes the vault so you can start again; your files aren't affected.
- **Locking:** the vault locks after **15 minutes** without activity, when you sign out, when you click **Lock**, and when the server restarts.
- **Items:**
  - *Login* items have a username, password, website and notes; *Secure note* items hold free text.
  - Each item can have a folder and can be marked as a favorite.
  - The last 5 passwords of each login are kept as history.
- **Generator:** sets length (8–64), character types, and can avoid look-alike characters such as `l 1 I O 0`. It uses the browser's secure random source.
- **Health:** dashboard cards count **weak**, **reused** and **older than 1 year** passwords. Click a card to filter the list.
- **Copying:** one click copies a username or password. On HTTPS the clipboard is cleared after 30 seconds.
- **Import / export** (the settings button on the Passwords page):
  - Import accepts CSV files exported from Chrome, Edge, Firefox, Bitwarden or LastPass.
  - Export writes a plain-text CSV and asks for your vault password first.

Vaults are stored in `DATA_DIR/vaults/` (inside the Docker volume) and are included in `./setup.sh backup`.

## Documents

Open **Documents** in the sidebar and pick a type:

| Type | What you get |
|---|---|
| **Letterhead** | A blank branded A4 page with logo, contact details, footer and fold marks |
| **Document** | A branded A4 page with title, date, reference, author and free text (blank line = new paragraph, `# ` = heading, `- ` = bullet) |
| **Meeting minutes** | Date, time, location, chair, minute taker, attendees, apologies, agenda, discussion, decisions, action items (task / owner / due) and next meeting |
| **Envelope** | DL, C5 or C4 envelope with return address, an optional note such as *Confidential*, and the recipient address |
| **Business card** | Front (logo on brand colour, optional tagline) and back (name, title, phone, mobile, email, website, address). 85 × 55 mm or 3.5 × 2 in, as a single card for a print shop or an A4 sheet of 10 with cut marks for a home printer |
| **Email signature** | A signature with logo, name, job title, phone, mobile, email, website, address and optional small print |

- **Form:** company details are shared by every type. The A4 preview updates as you type.
- **Saved to your account:** your details are stored on the server, so they're there on any device you sign in from.
- **Language:** Document and meeting minutes labels are in English or German.
- **Overflow warning:** a message appears if the text no longer fits on one page.
- **Output:**
  - **Print / Save as PDF** prints only the page at its true size (A4, the envelope size or the card size).
  - **Download HTML** gives a self-contained file with the logos embedded.
  - **Save to My files** stores that file, encrypted, in a `Documents` folder.
  - **Copy signature** (Email signature only) copies it so you can paste it into Outlook, Gmail or another mail app's signature settings.
- **Printing settings:** scale 100%, margins *None*, *Background graphics* on, *Headers and footers* off.

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
2. Name the app *Clover-X Personal Management*. Under *Supported account types*, choose one:
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

The full walkthrough, including the AWS **Network ACL** settings and HTTPS troubleshooting, is in **[DEPLOY.md](DEPLOY.md)**.

### 1. Launch the server
- **EC2 → Launch instance**: **Ubuntu 24.04 LTS**, `t3.small` or larger, 20 GB or more of storage. More storage means more room for files.
- **Security group:** allow **22** (SSH, your IP only), **80** and **443** (HTTP/HTTPS, anywhere).
- **Network ACL** of the subnet: inbound must also allow **80** and **443**. See [DEPLOY.md](DEPLOY.md#2b-network-acl-per-subnet--this-was-the-real-blocker).
- **Static IP:** allocate an **Elastic IP** and associate it with the instance.
- **Domain:** create a DNS **A record**, e.g. `share.clover-x.in`, pointing to that IP. HTTPS needs a domain.

### 2. Run the setup

**From your Windows PC (easiest):** double-click **`deploy.bat`**. It asks for three things:
- the server's public IP
- the SSH user (`ubuntu`)
- your `.pem` key file

It then uploads the project and runs the setup on the server.

**Or directly on the server:**
```bash
git clone https://github.com/YOUR-ACCOUNT/File-Share.git clover-x-share
cd clover-x-share
bash setup.sh
```

`setup.sh` takes care of everything:
- installs Docker and Docker Compose, and adds swap on small instances
- detects the public IP
- asks how people should reach the server (see below)
- generates the encryption key and `.env`, and asks for the admin password and optional Microsoft settings
- opens the firewall, builds, starts, and checks that the site is reachable from the internet

**Address options:**
1. **`https://13-233-45-67.sslip.io`** (recommended): a free HTTPS name built from your IP. No domain needed, and Microsoft sign-in works. Needs ports **80 and 443** open.
2. **Your own domain** with HTTPS. Create the DNS A record first; the script checks it.
3. **`http://YOUR-IP`**: plain HTTP. Not encrypted in transit, and no Microsoft sign-in.

To run it without prompts:
```bash
bash setup.sh install --yes --mode sslip --admin-password 'S0mething-Strong'
```

### 3. Everyday operations
```bash
./setup.sh status      # containers, health, URL
./setup.sh doctor      # explains why the site or HTTPS isn't reachable
./setup.sh logs        # live log
./setup.sh update      # git pull + rebuild (data kept)
./setup.sh backup      # data volume + .env -> ./backups (copy them off the server!)
./setup.sh restart | stop | start
./setup.sh             # change address, admin password or Microsoft settings
```

Locked out of Admin? Set `RESET_ADMIN=1` in `.env`, run `./setup.sh start`, sign in, then set it back to `0`.

The data lives in the Docker volume `clover-x_cx-data`.

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
lib/vault.js         encrypted password vaults (data/vaults/)
lib/http.js          HTTP helpers
public/              web app (index.html, style.css, app.js, vault.js, stationery.js)
logo/                Clover-X brand assets
Dockerfile, docker-compose.yml, Caddyfile, .env.example
```
