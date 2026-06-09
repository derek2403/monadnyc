import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT) || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const DURATION_SEC = 20;
const CODE_RE = /^[A-Z2-9]{4,8}$/;
const SLOT_GRACE_MS = 5000;
const ROOM_GRACE_MS = 15000;

const rooms = new Map();

function newRoom(code) {
  return {
    code,
    host: null,
    guest: null,
    slotTimers: { host: null, guest: null },
    roomTimer: null,
    tickInterval: null,
    state: {
      status: "waiting",
      scores: [0, 0],
      endTime: 0,
      timeLeft: DURATION_SEC,
      winner: null,
    },
  };
}

function peerStatus(slot) {
  if (!slot) return "empty";
  return slot.ws && slot.ws.readyState === 1 ? "online" : "reconnecting";
}

function snapshot(room) {
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
    peers: {
      host: peerStatus(room.host),
      guest: peerStatus(room.guest),
    },
  };
}

function broadcast(room) {
  const data = JSON.stringify(snapshot(room));
  for (const slot of [room.host, room.guest]) {
    if (slot?.ws && slot.ws.readyState === 1) slot.ws.send(data);
  }
}

function clearSlotTimer(room, which) {
  if (room.slotTimers[which]) {
    clearTimeout(room.slotTimers[which]);
    room.slotTimers[which] = null;
  }
}

function clearRoomTimer(room) {
  if (room.roomTimer) {
    clearTimeout(room.roomTimer);
    room.roomTimer = null;
  }
}

function scheduleRoomCleanup(room) {
  clearRoomTimer(room);
  if (room.host || room.guest) return;
  room.roomTimer = setTimeout(() => {
    if (room.host || room.guest) return;
    if (room.tickInterval) clearInterval(room.tickInterval);
    rooms.delete(room.code);
  }, ROOM_GRACE_MS);
}

function scheduleSlotCleanup(room, which) {
  clearSlotTimer(room, which);
  room.slotTimers[which] = setTimeout(() => {
    if (room[which] && !room[which].ws) {
      room[which] = null;
      broadcast(room);
      scheduleRoomCleanup(room);
    }
  }, SLOT_GRACE_MS);
}

function startTicker(room) {
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
    }
    broadcast(room);
  }, 1000);
}

await app.prepare();

const server = createServer((req, res) => {
  const parsed = parse(req.url, true);
  handle(req, res, parsed);
});

const wss = new WebSocketServer({ server, path: "/api/ws" });

wss.on("connection", (ws, req) => {
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
});

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port}`);
});
