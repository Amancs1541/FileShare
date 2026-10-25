# Deploying Clover-X on AWS (EC2 + Ubuntu)

A step-by-step record of how this app is set up on AWS, including the problems we ran into and how each one was fixed.

**Result:** the app runs in Docker on an Ubuntu EC2 server. Caddy sits in front of it and gets a free HTTPS certificate from Let's Encrypt automatically.

```
Internet ──► AWS Network ACL ──► Security group ──► EC2 (Ubuntu)
                                                      ├─ clover-x-caddy        ports 80 + 443  (HTTPS, certificates)
                                                      └─ clover-x-file-share   127.0.0.1:3000  (the app)
                                                           └─ volume clover-x_cx-data  (users, files, encryption key)
```

Replace `<SERVER-IP>` below with your server's public IP, for example `13.49.78.6`.

---

## 1. Create the server

**EC2 → Instances → Launch instance**

| Setting | Value |
|---|---|
| OS image | Ubuntu Server 24.04 LTS |
| Instance type | `t3.small` (2 GB). `t3.micro` also works, because setup adds 1 GB of swap |
| Key pair | Create one (RSA, `.pem`) and keep the file safe. It can't be downloaded again |
| Storage | 30 GB gp3 or more. All uploaded files live here |

### Give it a fixed IP

**EC2 → Elastic IPs → Allocate → Actions → Associate** with the instance. Without an Elastic IP, the public IP changes when the instance stops, and the HTTPS address stops working.

---

## 2. Open the firewall: both AWS layers

AWS has **two** firewalls, and **both** must allow the traffic. On this server only the first was open at first. Port 22 worked but 80 and 443 timed out, because the second one blocked them.

### 2a. Security group (per instance)

**EC2 → Instances → your instance → Security tab → click the security group → Edit inbound rules**

| Type | Port | Source |
|---|---|---|
| SSH | 22 | My IP (or 0.0.0.0/0) |
| HTTP | 80 | 0.0.0.0/0 |
| HTTPS | 443 | 0.0.0.0/0 |

Edit the group shown on the instance's **Security** tab. A group with the right rules has no effect unless it's attached to the instance.

### 2b. Network ACL (per subnet) — this was the real blocker

**VPC → Network ACLs → the ACL associated with the instance's subnet**

The subnet ID is on the instance's **Networking** tab.

**Inbound rules**: rules are checked from the lowest number up, and the final `*` rule denies everything else.

| Rule # | Type | Port | Source | Allow/Deny |
|---|---|---|---|---|
| 100 | SSH | 22 | 0.0.0.0/0 | Allow |
| 110 | Custom TCP | 1024-65535 | 0.0.0.0/0 | Allow |
| **120** | **HTTP** | **80** | 0.0.0.0/0 | **Allow** |
| **130** | **HTTPS** | **443** | 0.0.0.0/0 | **Allow** |
| * | All traffic | All | 0.0.0.0/0 | Deny |

**Outbound rules**: Network ACLs don't let replies back out automatically. You need either:

| Rule # | Type | Port | Destination | Allow/Deny |
|---|---|---|---|---|
| 100 | All traffic | All | 0.0.0.0/0 | Allow |

or at least **TCP 1024-65535**, **80** and **443** to `0.0.0.0/0`. The server answers visitors on ports 1024–65535, and it uses 80 and 443 itself to reach Let's Encrypt and download Docker images.

### 2c. Check from your PC

```powershell
Test-NetConnection <SERVER-IP> -Port 22    # must be True
Test-NetConnection <SERVER-IP> -Port 80    # must be True
Test-NetConnection <SERVER-IP> -Port 443   # must be True
```

If `22` is True but `80` or `443` is False, AWS is still blocking them (step 2a or 2b). The Ubuntu firewall (`sudo ufw status`) was **inactive** here, so it wasn't involved.

---

## 3. Install the app on the server

Connect with MobaXterm, or from PowerShell:

```powershell
ssh -i "C:\path\to\key.pem" ubuntu@<SERVER-IP>
```

On the server:

```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/Amancs1541/FileShare.git FileShare
cd FileShare
chmod +x setup.sh
./setup.sh
```

If the repository is private, `git clone` asks for a password. Use a GitHub **Personal Access Token** with *Contents: Read* access, not your GitHub password.

`setup.sh` installs Docker, adds swap on small servers, writes `.env`, starts the containers and checks that everything is reachable. It asks four questions:

| Question | Answer |
|---|---|
| How should people reach the server? | **1** = HTTPS on a free name `https://<ip-with-dashes>.sslip.io` (recommended). **2** = HTTPS on your own domain (create the A record first). **3** = plain HTTP |
| Admin password | Type a strong one (8+ characters, letters and numbers, no `'`). **Don't press Enter**: the fallback default is visible in the public script |
| Microsoft sign-in | `n` for now. You can set it up later in Admin |

When it prints **"Clover-X Personal Management is live"**, open the URL and sign in as **Admin**.

The data volume survives reinstalls. If you run setup again on a server that already has data, the existing accounts stay, and the admin password is still the one from the **first** install.

---

## 4. Switching from HTTP to HTTPS

We first ran setup with option **3** (plain HTTP) to rule out HTTPS as the problem. To switch:

1. Make sure ports **80 and 443** pass both firewalls (step 2).
2. Run:
   ```bash
   cd ~/FileShare
   ./setup.sh
   ```
   Answer **n** to *"Keep it and just redeploy?"* and choose option **1**.
3. Wait for `✔ Reachable over HTTPS: https://…sslip.io`.

---

## 5. When HTTPS doesn't work

Run the built-in check:

```bash
./setup.sh doctor
```

It checks the app, the public IP, the ports and Caddy's log, and tells you which of these it is:

| Message / Caddy log | Cause | Fix |
|---|---|---|
| `Timeout during connect (likely firewall problem)` | Let's Encrypt can't reach the server | Open 80 and 443 in **both** the security group and the Network ACL (step 2), then `sudo docker restart clover-x-caddy` |
| `rateLimited` / `too many failed authorizations` | Too many failed attempts in a short time | Fix the cause, wait **1 hour**, then `sudo docker restart clover-x-caddy` |
| `Connection refused` | Nothing on 80/443, or still in HTTP mode | Run `./setup.sh` again and choose option 1. Check `sudo ss -ltnp \| grep -E ':(80\|443) '` |
| `DNS problem` / `NXDOMAIN` | Your domain doesn't point at the server | Fix the A record, or use option 1 (sslip.io) |
| `Public IP is now …, but setup used …` | The IP changed (no Elastic IP) | Attach an Elastic IP, run `./setup.sh` again and choose the mode again |

After a failure, Caddy waits longer and longer between retries. After fixing the cause, restart it so it tries again immediately, and watch the log:

```bash
sudo docker restart clover-x-caddy
sudo docker logs -f clover-x-caddy      # wait for "certificate obtained successfully", then Ctrl+C
```

### Tracing where traffic stops

```bash
sudo tcpdump -ni any tcp port 80 -c 5
```

While that runs, run `Test-NetConnection <SERVER-IP> -Port 80` on your PC.

- **No output** means AWS drops the traffic. Check the security group or Network ACL.
- **Lines appear** means traffic reaches the server. Check `sudo ss -ltnp` and `sudo iptables -S INPUT`.

Some Wi-Fi networks (college, office) block outgoing port 80. Test once from a phone on mobile data.

---

## 6. Problems we hit, and what fixed them

| Symptom | Cause | Fix |
|---|---|---|
| Install hung at *"Waiting for the app to start…"*, and `status` said *"App not responding"* although Docker said `(healthy)` | `setup.sh` checked health with `docker compose exec`, which fails on newer Docker versions | Fixed in `setup.sh`: it now asks the app on its host port and falls back to Docker's own health status |
| HTTPS certificate never arrived (`Timeout during connect`) | The subnet's **Network ACL** allowed only ports 22 and 1024–65535 | Added Network ACL inbound rules 120 (HTTP 80) and 130 (HTTPS 443), and checked the outbound rules |
| HTTP mode: *"Couldn't reach http://<SERVER-IP>"* | Same Network ACL problem | Same fix |
| Security group looked correct but ports still closed | The security group wasn't the only firewall | See step 2b |

---

## 7. Day-to-day commands

Run these from `~/FileShare` on the server.

| Command | What it does |
|---|---|
| `./setup.sh status` | Containers, health and URL |
| `./setup.sh doctor` | Explains why the site or HTTPS isn't reachable |
| `./setup.sh logs` | Live logs (Ctrl+C to leave) |
| `./setup.sh restart` / `stop` / `start` | Control the containers |
| `./setup.sh update` | `git pull` and rebuild. Users and files are kept |
| `./setup.sh backup` | Data volume and `.env` into `backups/` |
| `./setup.sh` | Change mode, address, admin password or Microsoft settings |
| `./setup.sh uninstall` | Remove the containers. Asks before deleting data |

### Shipping code changes

On your PC, commit and push. Then on the server:

```bash
cd ~/FileShare && ./setup.sh update
```

### Backups

The **encryption key** lives in the data volume (or in `.env`). Without it, the stored files can't be decrypted.

```bash
./setup.sh backup
```

Copy the backups to your PC (run this in PowerShell on the PC):

```powershell
scp -i "C:\path\to\key.pem" "ubuntu@<SERVER-IP>:~/FileShare/backups/*" .
```

Also set up daily disk snapshots: **EC2 → Lifecycle Manager → Create policy**.

### Starting over

```bash
./setup.sh backup                                    # first, if you want to keep anything
sudo docker rm -f $(sudo docker ps -aq) 2>/dev/null
sudo docker system prune -a --volumes -f             # deletes ALL containers, images and volumes (data!)
./setup.sh                                           # fresh install
```

---

## 8. Security checklist

- [ ] Admin password changed after the first sign-in (never the script's default)
- [ ] Running on **HTTPS**. Plain HTTP sends passwords unencrypted
- [ ] SSH (port 22) limited to **My IP** in the security group
- [ ] Elastic IP attached
- [ ] Backups of the data volume and `.env` stored **off** the server
