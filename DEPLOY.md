# Deploying Monad Arcade via Cloudflare Tunnel

You route traffic with **Cloudflare Tunnel** (`enclave-tunnel`), the same way as
`gym.derek2403.win → http://localhost:3000`. So we run the app in Docker on a
local port and add one tunnel route to it. No A-record, no open firewall ports,
no nginx — `cloudflared` terminates TLS and handles WebSockets itself.

```
Browser ──https──▶ Cloudflare edge ──(encrypted tunnel)──▶ cloudflared (your box)
                                                              └─▶ 127.0.0.1:8090 ─▶ monad-app:3000
```

The app is a **custom Node server** (`server.mjs` runs Next + the `/api/ws` and
`/api/bark` WebSocket servers) — run with Docker, **not** `next start`.

> ### Pick the hostname: use `monad.derek2403.win` (not `www.monad…`)
> Cloudflare's free Universal SSL covers `derek2403.win` and `*.derek2403.win`
> (**one** level only). `www.monad.derek2403.win` is two levels deep and would
> fail TLS unless you buy Advanced Certificate Manager. All your other services
> are single-level, so **`monad.derek2403.win`** is the consistent, free choice.
> This guide uses it; swap in whatever single-level name you like.

---

## 1. Deploy the app on the server

```bash
cd ~/projects
git clone <YOUR_REPO_URL> monadnyc
cd monadnyc
```

Create **`.env`** (gitignored — never shipped in the repo/image). `server.mjs`
reads this file directly at runtime:

```bash
nano .env
```
```ini
# Resolver / settlement wallet — must hold MON to pay gas on resolve().
PRIVATE_KEY=0xYOUR_RESOLVER_PRIVATE_KEY

# Dedicated RPC (recommended). Used by the browser (baked at build) AND server.
NEXT_PUBLIC_MONAD_RPC_URL=https://monad-testnet.g.alchemy.com/v2/YOUR_KEY

# Optional server-only RPC. If unset, falls back to the NEXT_PUBLIC one.
MONAD_RPC_URL=https://monad-testnet.g.alchemy.com/v2/YOUR_KEY
```

Build + start (publishes `127.0.0.1:8090`):

```bash
docker compose up -d --build
docker compose logs -f      # expect "Ready on http://0.0.0.0:3000" + "resolver ready"
```

Confirm it's listening locally:

```bash
curl -I http://127.0.0.1:8090        # expect HTTP/1.1 200 (or 308)
```

> **Port 8090 already in use?** Check with `sudo ss -ltnp | grep 8090`, pick a
> free one, and change it in **both** `docker-compose.yml` (the `ports:` line)
> and the tunnel route below.

---

## 2. Add the tunnel route (Cloudflare dashboard)

**Zero Trust → Networks → Tunnels → `enclave-tunnel` → Published application
routes → Add a published application** (same place your `gym`/`code` routes
live):

| Field | Value |
|---|---|
| Subdomain | `monad` |
| Domain | `derek2403.win` |
| Path | *(leave empty)* |
| Type | `HTTP` |
| URL | `localhost:8090` |

Save. Cloudflare auto-creates the DNS (CNAME → tunnel) and provisions the cert.
WebSockets work through the tunnel with no extra config.

Then open **https://monad.derek2403.win** 🎉

---

## 3. Redeploying after code changes

```bash
cd ~/projects/monadnyc
git pull
docker compose up -d --build
```
The tunnel route is unchanged — nothing to touch in Cloudflare.

> **Contract redeploys:** if you re-run the hardhat deploy, commit the updated
> `deployments/contracts.json` + `lib/contracts.ts`, then `git pull` + rebuild so
> server and browser point at the new addresses.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Tunnel route shows "bad gateway" | App not up / wrong port. `docker compose ps`, `curl -I http://127.0.0.1:8090`. |
| 525 / TLS error on `www.monad…` | Multi-level subdomain not covered by Universal SSL — use `monad.derek2403.win`. |
| Game connects but never settles | `docker compose logs` for `settle` lines; verify `PRIVATE_KEY` wallet holds MON and is the vault owner. |
| Camera/mic blocked | Must be HTTPS — Cloudflare tunnel hostnames are HTTPS by default; also turn on SSL/TLS → Edge Certificates → **Always Use HTTPS**. |
| WS keeps reconnecting | Confirm the route Type is `HTTP` (not TCP) and the page is loaded over https (client picks `wss://` automatically). |

No SSL/TLS **encryption mode** change is needed: the edge↔server hop is the
encrypted tunnel, so it's effectively Full already.

---

## Alternative: route through your nginx-proxy
Not needed with the tunnel, but if you'd rather front it with the existing
`nginx-proxy` (e.g. to share one tunnel route across sites): point a tunnel
route at `http://localhost:80`, put the app on the `proxy` Docker network
(remove the `ports:` mapping, add the network back), and use the vhost in
[`deploy/nginx/`](deploy/nginx/). The direct route above is simpler and
lower-latency.
