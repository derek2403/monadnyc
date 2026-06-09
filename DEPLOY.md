# Deploying Monad Arcade → monad.derek2403.win

Routed through your existing **Cloudflare Tunnel → nginx-proxy** stack, the same
way as `dashboard.derek2403.win`: the tunnel sends the hostname to nginx on
`localhost:80`, and nginx forwards by `server_name` to the app container on the
`proxy` network.

```
Browser ──https──▶ Cloudflare ──tunnel──▶ cloudflared ─▶ nginx:80 ─▶ monad-app:3000
```

The app is a **custom Node server** (`server.mjs` runs Next + the `/api/ws` and
`/api/bark` WebSocket servers) — run with Docker, **not** `next start`.

> ### Use `monad.derek2403.win` (single-level)
> Free Universal SSL covers `*.derek2403.win` (one level only). `www.monad…` is
> two levels deep and would fail TLS without Advanced Certificate Manager. All
> your other services are single-level, so stick with `monad.derek2403.win`.

---

## 1. Deploy the app

```bash
cd ~/projects
git clone <YOUR_REPO_URL> monadnyc
cd monadnyc
```

Create **`.env`** (gitignored — never shipped). `server.mjs` reads this file at
runtime:

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

Build + start (joins the `proxy` network; no host port published):

```bash
docker compose up -d --build
docker compose logs -f      # expect "Ready on http://0.0.0.0:3000" + "resolver ready"
```

---

## 2. Add the nginx vhost (matches your gym.conf / enclave.conf)

```bash
cp deploy/nginx/monad.derek2403.win.conf ~/nginx-proxy/conf.d/
docker exec nginx-proxy nginx -t        # validate
docker exec nginx-proxy nginx -s reload # apply (app must be up first)
```

---

## 3. Add the tunnel route (Cloudflare dashboard)

**Zero Trust → Networks → Tunnels → `enclave-tunnel` → Add a published
application** — same as your `dashboard` route:

| Field | Value |
|---|---|
| Subdomain | `monad` |
| Domain | `derek2403.win` |
| Type | `HTTP` |
| URL | `localhost:80` |

Save. Cloudflare creates the DNS + cert. WebSockets pass through with no extra
config.

Then open **https://monad.derek2403.win** 🎉

---

## 4. Redeploying after code changes

```bash
cd ~/projects/monadnyc
git pull
docker compose up -d --build
```
nginx re-resolves the container automatically (no reload needed). If you changed
`NEXT_PUBLIC_MONAD_RPC_URL`, `--build` rebuilds the bundle with it.

> **Contract redeploys:** commit the updated `deployments/contracts.json` +
> `lib/contracts.ts`, then `git pull` + rebuild so server and browser use the
> new addresses.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `502 Bad Gateway` | App not up / not on `proxy` net. `docker compose ps`, `docker network inspect proxy \| grep monad-app`. |
| nginx `-t` fails: *"host not found in upstream"* | App container down — start it, then reload. The `resolver` line defers lookups, so this is usually only at first reload. |
| Game connects but never settles | `docker compose logs` for `settle` lines; verify `PRIVATE_KEY` wallet holds MON and is the vault owner. |
| Camera/mic blocked | Must be HTTPS — tunnel hostnames are HTTPS; also SSL/TLS → Edge Certificates → **Always Use HTTPS = On**. |
| WS keeps reconnecting | Confirm the tunnel route Type is `HTTP` and the vhost has the `Upgrade`/`Connection` headers (it does). |

---

## Alternative: skip nginx (direct tunnel → app)
If you'd rather not use nginx, publish the app on a free host port instead and
point the tunnel route straight at it:
- In `docker-compose.yml`, replace the `networks:` block with `ports: ["127.0.0.1:8090:3000"]`.
- Tunnel route URL → `localhost:8090` (instead of `localhost:80`), no nginx conf.

One less hop, but it doesn't match your dashboard setup. The nginx path above is
recommended for consistency with your existing services.
