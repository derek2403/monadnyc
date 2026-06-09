# Deploying Monad Arcade → monad.derek2403.win

Routed through your **Cloudflare Tunnel** straight to the app — the same shape as
`gym.derek2403.win → http://localhost:3000`. No nginx in the path: `cloudflared`
terminates TLS and handles WebSockets, forwarding to the app's local port.

```
Browser ──https──▶ Cloudflare ──tunnel──▶ cloudflared (host) ──▶ 127.0.0.1:8090 ──▶ monad-app:3000
```

The app is a **custom Node server** (`server.mjs` runs Next + the `/api/ws` and
`/api/bark` WebSocket servers) — run with Docker, **not** `next start`.

> ### Use `monad.derek2403.win` (single-level)
> Free Universal SSL covers `*.derek2403.win` (one level only). `www.monad…` is
> two levels deep and needs Advanced Certificate Manager. Stay single-level.

---

## 1. Deploy the app

```bash
cd ~/projects
git clone <YOUR_REPO_URL> monadnyc   # (first time only)
cd monadnyc
```

Create **`.env`** (gitignored — never shipped). `server.mjs` reads this file at
runtime, and `NEXT_PUBLIC_MONAD_RPC_URL` is baked into the bundle at build time:

```ini
PRIVATE_KEY=0xYOUR_RESOLVER_PRIVATE_KEY
NEXT_PUBLIC_MONAD_RPC_URL=https://monad-testnet.g.alchemy.com/v2/YOUR_KEY
MONAD_RPC_URL=https://monad-testnet.g.alchemy.com/v2/YOUR_KEY   # optional, server-only
```

Build + start (publishes `127.0.0.1:8090`):

```bash
docker compose up -d --build
docker compose logs -f      # expect "Ready on..." + "On-chain resolver ready: 0x..."
curl -I http://127.0.0.1:8090   # expect HTTP/1.1 200
```

---

## 2. Tunnel route (Cloudflare → Zero Trust → Networks → Tunnels → enclave-tunnel)

Add/confirm a published application — **same as your `gym` route**:

| Field | Value |
|---|---|
| Subdomain | `monad` |
| Domain | `derek2403.win` |
| Type | `HTTP` |
| **URL** | **`localhost:8090`** |

## 3. TLS (one-time, zone-wide)

- **SSL/TLS → Overview → `Full`** (required for tunnels).
- **SSL/TLS → Edge Certificates → Always Use HTTPS = On.**

Open **https://monad.derek2403.win** 🎉

---

## Redeploying after code changes

**Laptop:**
```bash
git add -A && git commit -m "your change" && git push origin main
```
**Server:**
```bash
cd ~/projects/monadnyc && git pull origin main && docker compose up -d --build
```
The tunnel route and TLS are unchanged — nothing to touch in Cloudflare.

> **Contract redeploys:** commit the updated `deployments/contracts.json` +
> `lib/contracts.ts`, then pull + rebuild so server and browser use the new
> addresses.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| 502 Bad Gateway | App not on `127.0.0.1:8090`. `docker port monad-app` must show `3000/tcp -> 127.0.0.1:8090`; `curl -I http://127.0.0.1:8090`. Make sure the tunnel route URL is `localhost:8090`. |
| HTTP works, HTTPS doesn't | SSL/TLS mode not `Full`, or Universal SSL still provisioning (wait ~15 min). |
| Game never settles | `docker compose logs` for `settle` lines; `PRIVATE_KEY` wallet must hold MON and be the vault owner. |
| Camera/mic blocked | Needs HTTPS — turn on Always Use HTTPS. |

> The files in [`deploy/nginx/`](deploy/nginx/) are an **optional alternative**
> (route the tunnel to `localhost:80` → nginx → `monad-app:3000` on the `proxy`
> network). Not used by the direct setup above.
