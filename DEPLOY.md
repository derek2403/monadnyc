# Deploying Monad Arcade → https://www.monad.derek2403.win

The app is a **custom Node server** (`server.mjs`) that runs Next.js plus two
WebSocket servers (`/api/ws` for 67, `/api/bark` for bark). It is run with Docker
and sits behind your existing `nginx-proxy` container, with Cloudflare in front
terminating TLS.

```
Browser ──https──▶ Cloudflare ──http:80──▶ nginx-proxy (container)
                                              └─(proxy network)─▶ monad-app:3000
```

---

## 1. Cloudflare (DNS + TLS)

1. Cloudflare dashboard → zone **derek2403.win** → **DNS → Records → Add record**:
   - Type `A`, Name `www.monad`, IPv4 = your server's public IP, **Proxied** (orange cloud) ✅
   - (optional) Type `A`, Name `monad`, same IP, Proxied — so the bare
     `monad.derek2403.win` resolves too (the vhost already answers both).

   Find the server IP with: `curl -4 ifconfig.me`

2. **SSL/TLS → Overview → Flexible.**
   Your origin only serves HTTP:80, so Flexible (browser↔CF is HTTPS, CF↔origin
   is HTTP) is what matches this setup.
   - *Later, for better security:* install a Cloudflare **Origin Certificate**,
     add a `listen 443 ssl` server block + open 443, then switch to **Full
     (strict)**. Not required to go live.

3. **SSL/TLS → Edge Certificates → Always Use HTTPS = On** (redirects http→https
   at the edge). `getUserMedia` (camera/mic) requires HTTPS, so this matters.

4. **Network → WebSockets = On** (it's on by default — just confirm).

> Firewall: make sure inbound **TCP 80** is open on the server (and ideally
> restricted to [Cloudflare's IP ranges](https://www.cloudflare.com/ips/)).

---

## 2. Deploy on the server

```bash
cd ~/projects
git clone <YOUR_REPO_URL> monadnyc
cd monadnyc
```

Create the **`.env`** file (it is gitignored — it never ships in the repo or the
image). `server.mjs` reads this file directly at runtime:

```bash
nano .env
```
```ini
# Resolver / settlement wallet — must hold MON to pay gas on resolve().
PRIVATE_KEY=0xYOUR_RESOLVER_PRIVATE_KEY

# Dedicated RPC (recommended). Used by the browser (baked at build) AND server.
NEXT_PUBLIC_MONAD_RPC_URL=https://monad-testnet.g.alchemy.com/v2/YOUR_KEY

# Optional: a separate, private RPC for the server only. If unset, the server
# falls back to NEXT_PUBLIC_MONAD_RPC_URL, then to the public endpoint.
MONAD_RPC_URL=https://monad-testnet.g.alchemy.com/v2/YOUR_KEY
```

Build + start (joins the existing `proxy` network; no host port is published):

```bash
docker compose up -d --build
docker compose logs -f      # expect: "Ready on http://0.0.0.0:3000" + "On-chain resolver ready: 0x..."
```

---

## 3. Wire up nginx

Copy the vhost (and the WS map, unless you already have one) into your proxy's
`conf.d`, then reload:

```bash
# from ~/projects/monadnyc
cp deploy/nginx/monad.derek2403.win.conf ~/nginx-proxy/conf.d/

# Only if you DON'T already have a `$connection_upgrade` map in conf.d:
cp deploy/nginx/ws-upgrade-map.conf ~/nginx-proxy/conf.d/

# Validate + reload (app must be up so the upstream resolves)
docker exec nginx-proxy nginx -t
docker exec nginx-proxy nginx -s reload
```

Now browse **https://www.monad.derek2403.win** 🎉

---

## 4. Redeploying after code changes

```bash
cd ~/projects/monadnyc
git pull
docker compose up -d --build
```
nginx re-resolves the container automatically (no nginx reload needed). If you
changed `NEXT_PUBLIC_MONAD_RPC_URL`, the `--build` rebuilds the bundle with it.

> **Contract redeploys:** if you re-run the hardhat deploy, `deployments/contracts.json`
> and `lib/contracts.ts` change. Commit them, then `git pull` + rebuild here so
> the server and browser point at the new addresses.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `502 Bad Gateway` | App container not up or not on `proxy` net. `docker compose ps`, `docker compose logs`. |
| nginx won't reload: *"unknown upstream"* / resolve error | App container down — start it first, then reload. |
| nginx won't start: *"duplicate map \$connection_upgrade"* | Another conf.d already defines the WS map — delete `ws-upgrade-map.conf`. |
| Game connects but never settles | Check `docker compose logs` for `settle` lines; verify `PRIVATE_KEY` wallet has MON and is the vault owner. |
| Camera/mic blocked | Must be HTTPS — confirm Cloudflare "Always Use HTTPS" is on. |
| WS keeps reconnecting | Confirm Cloudflare **Network → WebSockets = On** and the vhost has the `Upgrade`/`Connection` headers. |

## Why Docker (not PM2) here
`nginx-proxy` is itself a container on the `proxy` network, so it reaches
`monad-app` **container-to-container with no host hop** — the lowest-latency
path. Docker also pins Node and makes builds reproducible. PM2 would add an
nginx-container→host networking hop and host Node management.
