import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT) || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const DURATION_SEC = 10;
const CODE_RE = /^[A-Z2-9]{4,8}$/;
const SLOT_GRACE_MS = 5000;
const ROOM_GRACE_MS = 15000;

// ---- Shared on-chain settlement (vault payout) ----
let publicClient = null;
let walletClient = null;
let vaultAbi = null;
let vaultAddresses = {};

try {
  const here = new URL("./", import.meta.url);
  const deployments = JSON.parse(
    readFileSync(new URL("deployments/contracts.json", here), "utf8"),
  );
  const env = readFileSync(new URL(".env", here), "utf8");
  let pk = env.match(/^PRIVATE_KEY=(.+)$/m)?.[1]?.trim();
  if (pk && !pk.startsWith("0x")) pk = `0x${pk}`;
  if (!pk) throw new Error("PRIVATE_KEY missing");

  // Prefer a dedicated RPC (e.g. Alchemy) for settlement — the public endpoint
  // is rate-limited and makes resolve/receipt polling flaky under load.
  const rpcUrl =
    env.match(/^MONAD_RPC_URL=(.+)$/m)?.[1]?.trim() ||
    env.match(/^NEXT_PUBLIC_MONAD_RPC_URL=(.+)$/m)?.[1]?.trim() ||
    "https://testnet-rpc.monad.xyz";

  const chain = defineChain({
    id: deployments.chainId,
    name: "Monad Testnet",
    nativeCurrency: { decimals: 18, name: "Monad", symbol: "MON" },
    rpcUrls: { default: { http: [rpcUrl] } },
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  });
  const account = privateKeyToAccount(pk);
  publicClient = createPublicClient({ chain, transport: http(rpcUrl, { batch: true }) });
  walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  console.log("> RPC:", rpcUrl.replace(/\/v2\/.*/, "/v2/***"));
  vaultAbi = deployments.vaultAbi;
  vaultAddresses = { sixseven: deployments.vault, bark: deployments.barkVault };
  console.log("> On-chain resolver ready:", account.address);
} catch (e) {
  console.warn("> On-chain resolver disabled:", e.message);
}

/**
 * Build an isolated game instance: its own room registry, timers and
 * (optional) on-chain settlement. Two instances never share state, so the
 * 67 game and the bark game can't interfere even with identical room codes.
 */
function makeGame({ label, vaultAddress }) {
  const rooms = new Map();

  const newRoom = (code) => ({
    code,
    host: null,
    guest: null,
    slotTimers: { host: null, guest: null },
    roomTimer: null,
    tickInterval: null,
    resolving: false,
    resolved: false,
    state: {
      status: "waiting",
      scores: [0, 0],
      endTime: 0,
      timeLeft: DURATION_SEC,
      winner: null,
    },
  });

  const peerStatus = (slot) =>
    !slot ? "empty" : slot.ws && slot.ws.readyState === 1 ? "online" : "reconnecting";

  const snapshot = (room) => {
    const timeLeft =
      room.state.status === "running"
        ? Math.max(0, Math.ceil((room.state.endTime - Date.now()) / 1000))
        : room.state.timeLeft;
    return {
      type: "state",
      scores: room.state.scores,
      timeLeft,
      status: room.state.status,
      winner: room.state.winner,
      peers: { host: peerStatus(room.host), guest: peerStatus(room.guest) },
    };
  };

  const broadcast = (room) => {
    const data = JSON.stringify(snapshot(room));
    for (const slot of [room.host, room.guest]) {
      if (slot?.ws && slot.ws.readyState === 1) slot.ws.send(data);
    }
  };

  const clearSlotTimer = (room, which) => {
    if (room.slotTimers[which]) {
      clearTimeout(room.slotTimers[which]);
      room.slotTimers[which] = null;
    }
  };

  const clearRoomTimer = (room) => {
    if (room.roomTimer) {
      clearTimeout(room.roomTimer);
      room.roomTimer = null;
    }
  };

  const scheduleRoomCleanup = (room) => {
    clearRoomTimer(room);
    if (room.host || room.guest) return;
    room.roomTimer = setTimeout(() => {
      if (room.host || room.guest) return;
      if (room.tickInterval) clearInterval(room.tickInterval);
      rooms.delete(room.code);
    }, ROOM_GRACE_MS);
  };

  const scheduleSlotCleanup = (room, which) => {
    clearSlotTimer(room, which);
    room.slotTimers[which] = setTimeout(() => {
      if (room[which] && !room[which].ws) {
        room[which] = null;
        broadcast(room);
        scheduleRoomCleanup(room);
      }
    }, SLOT_GRACE_MS);
  };

  const resolveOnChain = async (room) => {
    if (!walletClient || !vaultAddress || room.resolving || room.resolved) return;
    room.resolving = true;
    try {
      const matchId = keccak256(toBytes(room.code.toUpperCase()));
      const m = await publicClient.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "getMatch",
        args: [matchId],
      });
      const status = Number(m[4]);
      // Only a Funded (2) match needs settling. Free play (0/1), already
      // resolved (3) or cancelled (4) are terminal — mark done so we stop.
      if (status !== 2) {
        room.resolved = true;
        return;
      }
      const winnerRole = room.state.winner === null ? 2 : room.state.winner;
      const hash = await walletClient.writeContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "resolve",
        args: [matchId, winnerRole],
      });
      // Wait for the receipt before declaring victory — a submitted tx that
      // later reverts must NOT be treated as settled, or the room hangs forever.
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        room.resolved = true;
        console.log(`> [${label}:${room.code}] settled role=${winnerRole} tx=${hash}`);
      } else {
        console.error(`> [${label}:${room.code}] settle reverted ${hash} — will retry`);
      }
    } catch (e) {
      console.error(`> [${label}:${room.code}] settle failed:`, e.shortMessage || e.message);
    } finally {
      room.resolving = false;
    }
  };

  // Settlement can fail transiently (RPC blip, nonce race, momentary revert).
  // Retry a few times with backoff so a finished match never gets stuck on
  // "Settling on-chain". resolveOnChain self-heals: once the match reads back
  // as Resolved it marks the room done.
  const settleWithRetry = async (room) => {
    for (let attempt = 0; attempt < 6 && !room.resolved; attempt++) {
      await resolveOnChain(room);
      if (room.resolved) return;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  };

  const startTicker = (room) => {
    if (room.tickInterval) clearInterval(room.tickInterval);
    room.tickInterval = setInterval(() => {
      if (room.state.status !== "running") {
        clearInterval(room.tickInterval);
        room.tickInterval = null;
        return;
      }
      const remaining = Math.max(
        0,
        Math.ceil((room.state.endTime - Date.now()) / 1000),
      );
      if (remaining <= 0) {
        room.state.status = "finished";
        const [s1, s2] = room.state.scores;
        room.state.winner = s1 > s2 ? 0 : s2 > s1 ? 1 : null;
        room.state.timeLeft = 0;
        clearInterval(room.tickInterval);
        room.tickInterval = null;
        settleWithRetry(room); // fire-and-forget payout, retried on failure
      }
      broadcast(room);
    }, 1000);
  };

  const onConnection = (ws, req) => {
    const { query } = parse(req.url, true);
    const code = String(query.code || "").toUpperCase();
    const clientId = String(query.clientId || "");
    if (!CODE_RE.test(code) || !clientId) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid request" }));
      ws.close();
      return;
    }

    let room = rooms.get(code);
    if (!room) {
      room = newRoom(code);
      rooms.set(code, room);
    }
    clearRoomTimer(room);

    let role = null;
    if (room.host?.clientId === clientId) {
      room.host.ws = ws;
      role = "host";
      clearSlotTimer(room, "host");
    } else if (room.guest?.clientId === clientId) {
      room.guest.ws = ws;
      role = "guest";
      clearSlotTimer(room, "guest");
    }

    if (!role) {
      if (!room.host) {
        room.host = { clientId, ws };
        role = "host";
      } else if (!room.guest) {
        room.guest = { clientId, ws };
        role = "guest";
      } else {
        ws.send(JSON.stringify({ type: "error", message: "Room is full" }));
        ws.close();
        return;
      }
    }

    ws.send(JSON.stringify({ type: "joined", role, code }));
    broadcast(room);

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "score") {
        if (room.state.status !== "running") return;
        const idx = role === "host" ? 0 : 1;
        room.state.scores[idx] += 1;
        broadcast(room);
        return;
      }

      if (msg.type === "start") {
        if (role !== "host") return;
        if (peerStatus(room.host) !== "online" || peerStatus(room.guest) !== "online") return;
        room.state.status = "running";
        room.state.scores = [0, 0];
        room.state.winner = null;
        room.state.endTime = Date.now() + DURATION_SEC * 1000;
        room.state.timeLeft = DURATION_SEC;
        room.resolved = false;
        startTicker(room);
        broadcast(room);
        return;
      }

      if (msg.type === "reset") {
        if (role !== "host") return;
        room.state.status = "waiting";
        room.state.scores = [0, 0];
        room.state.winner = null;
        room.state.timeLeft = DURATION_SEC;
        if (room.tickInterval) {
          clearInterval(room.tickInterval);
          room.tickInterval = null;
        }
        broadcast(room);
        return;
      }
    });

    ws.on("close", () => {
      let which = null;
      if (room.host?.ws === ws) which = "host";
      else if (room.guest?.ws === ws) which = "guest";
      if (!which) return;
      room[which].ws = null;
      scheduleSlotCleanup(room, which);
      broadcast(room);
    });
  };

  return { onConnection };
}

await app.prepare();

// Two isolated games, each on its own WS path and escrow vault.
const game67 = makeGame({ label: "67", vaultAddress: vaultAddresses.sixseven });
const gameBark = makeGame({ label: "bark", vaultAddress: vaultAddresses.bark });

const server = createServer((req, res) => {
  handle(req, res, parse(req.url, true));
});

const ws67 = new WebSocketServer({ noServer: true });
ws67.on("connection", game67.onConnection);

const wsBark = new WebSocketServer({ noServer: true });
wsBark.on("connection", gameBark.onConnection);

// Route upgrades by path; hand anything else (e.g. Next HMR) back to Next.
const nextUpgrade =
  typeof app.getUpgradeHandler === "function" ? app.getUpgradeHandler() : null;

server.on("upgrade", (req, socket, head) => {
  const { pathname } = parse(req.url);
  if (pathname === "/api/ws") {
    ws67.handleUpgrade(req, socket, head, (ws) => ws67.emit("connection", ws, req));
  } else if (pathname === "/api/bark") {
    wsBark.handleUpgrade(req, socket, head, (ws) => wsBark.emit("connection", ws, req));
  } else if (nextUpgrade) {
    nextUpgrade(req, socket, head);
  }
});

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port}`);
  console.log("> games: /api/ws (67) · /api/bark (bark)");
});
