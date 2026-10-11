# The server on Oracle Cloud's free tier

Runs the whole server — database, photos, calls, everything Docker runs on
the PC today — on a machine that is on all the time, so the app works
whether the PC is on or not. Oracle's Always Free tier includes an ARM
machine with 4 cores and 24 GB of memory, far more than this needs, for
nothing.

The phones keep reaching the server over **Tailscale**, as they do now.
Nothing is opened to the internet: Oracle's network only lets SSH in, and
that stays the only door.

About 30 minutes, most of it waiting.

## 1. The account (once)

<https://www.oracle.com/cloud/free/> → **Start for free**. It asks for a card
to check you are a person; Always Free resources never charge it.

Pick the **home region** carefully: it cannot be changed, and free machines
only exist there. The nearest one to you is the right one.

## 2. The machine

Menu (☰) → **Compute** → **Instances** → **Create instance**.

| Setting | Choose |
|---|---|
| Name | `loversrock` |
| Image | **Change image** → **Canonical Ubuntu** → **24.04** |
| Shape | **Change shape** → **Ampere** → **VM.Standard.A1.Flex**, **4 OCPUs, 24 GB** ("Always Free-eligible") |
| Networking | **Create new virtual cloud network**, **public subnet**, **Assign a public IPv4 address** ticked |
| SSH keys | **Generate a key pair for me** → **Save private key** *and* **Save public key** |
| Boot volume | leave it, or 100 GB (up to 200 GB is free) |

**Create**. When it says **Running**, copy its **Public IP address**.

> **"Out of capacity for shape VM.Standard.A1.Flex"** is common on new
> accounts. Try again later (early morning works best), try 2 OCPUs / 12 GB,
> or another availability domain in the same dialog. Upgrading the account
> to Pay As You Go (Billing → Upgrade) makes capacity much easier to get and
> still costs nothing as long as you stay within the Always Free limits.

## 3. Connect

In PowerShell on the PC, with the key you saved (the `.key` file):

```powershell
ssh -i $env:USERPROFILE\Downloads\ssh-key-*.key ubuntu@<PUBLIC_IP>
```

Answer `yes` the first time. If Windows complains the key's permissions are
too open, move it out of Downloads into `C:\Users\<you>\.ssh\` and try again.

## 4a. A fresh server

On the server:

```bash
curl -fsSL https://raw.githubusercontent.com/s-rakim/loversrock/claude/stoic-volta-vv3b26/docker/server-setup.sh | bash
```

It installs Docker and Tailscale, prints a Tailscale link — open it and sign
in with **the same account the phones use** — then builds and starts
everything. The first build takes 5–15 minutes. It ends by printing the
server address for the app, `http://100.x.y.z:4000`.

Then put your keys in (Firebase, the AI connectors, whatever you had on the
PC):

```bash
nano ~/loversrock/backend/.env
cd ~/loversrock && bash docker/server-setup.sh
```

## 4b. Moving your existing server across (photos, messages, settings)

Instead of 4a. On the **PC**, in the loversrock folder, right before you
switch:

```powershell
git pull
powershell -ExecutionPolicy Bypass -File .\export-for-server.ps1
scp -i C:\path\to\ssh-key.key loversrock-move.tar.gz ubuntu@<PUBLIC_IP>:~
```

Then on the **server**:

```bash
curl -fsSL https://raw.githubusercontent.com/s-rakim/loversrock/claude/stoic-volta-vv3b26/docker/server-setup.sh | bash -s -- --restore ~/loversrock-move.tar.gz
```

That carries over the database, every photo, drawing and voice note, and
both `.env` files — so your Firebase key, AI keys and sign-in secrets come
too, and nobody has to sign in again. Only the two addresses the phones use
for calls change, to the new machine's.

`loversrock-move.tar.gz` holds your secrets and all your photos: once
everything works, delete it from the PC and the server
(`rm ~/loversrock-move.tar.gz`).

## 5. Switch the phones over

On each phone:

1. **Tailscale on**, same account.
2. loversrock → **Settings** → **Server address** →
   `http://<the address the script printed>:4000`.

Then turn the PC's server off, so nothing lands on the old one:

```powershell
cd docker
docker compose down
```

(`down` keeps the PC's data; it is still there if you ever go back.)

## Afterwards

**Updating the server** — on the server:

```bash
cd ~/loversrock && bash docker/server-setup.sh
```

**Updating the phones** — still on the PC, without starting the old server:

```powershell
powershell -ExecutionPolicy Bypass -File .\update.ps1 -SkipServer
```

**Logs:**

```bash
sudo docker compose -f ~/loversrock/docker/docker-compose.yml logs backend --tail 50
```

**Backups:** Always Free includes five boot-volume backups. Instance →
**Boot volume** → **Create boot volume backup** now and then is enough.

**Idle machines.** Oracle may reclaim an Always Free machine that sits almost
completely idle for a week. A server two phones use every day is unlikely to
look idle; upgrading the account to Pay As You Go (still free within the
limits) stops it applying at all.

## What not to do

- Don't add ingress rules for port 4000 (or 9000, 5432) in Oracle's security
  list. The app sends sign-ins and messages to the server over plain HTTP;
  over Tailscale that is encrypted, over the open internet it is not.
- Don't share the `.key` file — it is the only way into the machine.
