# Clover-X File Share

A Clover-X branded file sharing server for your local network. Phones, tablets and laptops on the same Wi-Fi can open the page in a browser to upload and download files. No apps, accounts or internet are needed.

- **Zero dependencies.** It needs only Node.js 18.15 or newer.
- Upload by drag and drop: multiple files, whole folders, or pasted screenshots. Progress, speed and cancel are shown for each file.
- Folders, search, sorting, rename and delete
- Built-in preview for images, video, audio, PDF and text/code files
- Video seeking works because the server supports range requests
- QR code so phones can open the page quickly
- Light and dark theme using your logos
- Optional PIN lock and read-only mode

## Run it

```bash
node server.js
```

You can also double-click **`start.bat`** on Windows.

The console prints the address to open on other devices, for example:

```
Network:   http://192.168.0.102:3000   ← open this on other devices
```

Shared files are stored in the `shared/` folder next to `server.js`.

## Options

| Flag | Env var | Default | What it does |
|---|---|---|---|
| `--port 3000` | `PORT` | `3000` | Port to listen on (if 3000 is busy and no port was given, the next free one is used) |
| `--host 0.0.0.0` | `HOST` | `0.0.0.0` | Bind address. Set one specific IP to listen only on that network |
| `--dir D:\Share` | `SHARE_DIR` | `./shared` | Folder that gets shared |
| `--pin 1234` | `SHARE_PIN` | *(off)* | Ask for a PIN before anyone can see the files |
| `--readonly` | `READ_ONLY=1` | off | Allow downloads only. Upload, rename and delete are turned off |

Example:

```bash
node server.js --port 9000 --dir "D:\Movies" --pin 2580 --readonly
```

## Windows Firewall

The first time it runs, Windows asks whether Node.js can use the network. Tick **Private networks** and click Allow. If other devices can't connect, run this once in an admin PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Clover-X File Share" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

## Notes

- Only use this on networks you trust. Without `--pin`, anyone on the same Wi-Fi can read, upload and delete files.
- Traffic uses plain HTTP, which is fine on your home network but is not encrypted.
- Changing the PIN or restarting the server signs everyone out.
- Branding comes from `logo/`. The UI uses the `*-dark.svg` logos on light backgrounds and the `*-white.svg` logos on dark backgrounds.
