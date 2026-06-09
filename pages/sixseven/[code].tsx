import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

type LandmarkPoint = { x: number; y: number; z: number };
type DetectionResult = { landmarks: LandmarkPoint[][] };
type HandLandmarkerInstance = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => DetectionResult;
  close: () => void;
};

type HandSide = "left" | "right";
type SeesawStatus =
  | { kind: "waiting" }
  | { kind: "closed" }
  | { kind: "level" }
  | { kind: "tilt"; higher: HandSide };

type Role = "host" | "guest";
type GameStatus = "waiting" | "running" | "finished";
type PeerStatus = "online" | "reconnecting" | "empty";
type ConnState = "connecting" | "online" | "reconnecting" | "failed";

type ServerState = {
  scores: [number, number];
  timeLeft: number;
  status: GameStatus;
  winner: number | null;
  peers: { host: PeerStatus; guest: PeerStatus };
};

const VISION_BUNDLE = "/mediapipe/vision_bundle.mjs";
const WASM_BASE = "/mediapipe/wasm";
const MODEL_URL = "/models/hand_landmarker.task";

const SCORE_COOLDOWN_MS = 220;
const TILT_THRESHOLD = 0.07;
const MAX_RECONNECT_ATTEMPTS = 12;

const dynamicImport = new Function("u", "return import(u)") as (
  u: string,
) => Promise<any>;

async function createHandLandmarker(): Promise<HandLandmarkerInstance> {
  const vision = await dynamicImport(VISION_BUNDLE);
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
  const opts = {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" as const },
    runningMode: "VIDEO" as const,
    numHands: 2,
  };
  try {
    return await vision.HandLandmarker.createFromOptions(fileset, opts);
  } catch {
    return await vision.HandLandmarker.createFromOptions(fileset, {
      ...opts,
      baseOptions: { ...opts.baseOptions, delegate: "CPU" as const },
    });
  }
}

function detectFingers(landmarks: LandmarkPoint[]): boolean[] {
  const tipIds = [4, 8, 12, 16, 20];
  const pipIds = [3, 6, 10, 14, 18];
  const wrist = landmarks[0];
  const dist = (i: number) =>
    Math.hypot(landmarks[i].x - wrist.x, landmarks[i].y - wrist.y);
  return tipIds.map((t, i) => dist(t) > dist(pipIds[i]) * 1.1);
}

function isPalmOpen(landmarks: LandmarkPoint[]): boolean {
  const fingers = detectFingers(landmarks);
  let extended = 0;
  for (let i = 1; i < 5; i++) if (fingers[i]) extended++;
  return extended >= 3;
}

function classifySeesaw(hands: LandmarkPoint[][]): SeesawStatus {
  if (hands.length < 2) return { kind: "waiting" };
  const sorted = [...hands].sort((a, b) => a[0].x - b[0].x);
  const leftHand = sorted[0];
  const rightHand = sorted[1];
  if (!isPalmOpen(leftHand) || !isPalmOpen(rightHand)) {
    return { kind: "closed" };
  }
  const leftY = leftHand[0].y;
  const rightY = rightHand[0].y;
  const diff = leftY - rightY;
  if (Math.abs(diff) < TILT_THRESHOLD) return { kind: "level" };
  return { kind: "tilt", higher: diff < 0 ? "left" : "right" };
}

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function getClientId(): string {
  if (typeof window === "undefined") return "";
  const key = "sixseven-client-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));
    sessionStorage.setItem(key, id);
  }
  return id;
}

export default function SixSevenRoom() {
  const router = useRouter();
  const code = String(router.query.code ?? "").toUpperCase();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarkerInstance | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const lastHigherRef = useRef<HandSide | null>(null);
  const cooldownUntilRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const runningRef = useRef(false);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SeesawStatus>({ kind: "waiting" });

  const [role, setRole] = useState<Role | null>(null);
  const [server, setServer] = useState<ServerState | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    runningRef.current = server?.status === "running";
  }, [server?.status]);

  useEffect(() => {
    if (!router.isReady || !code) return;
    const url = `${window.location.origin}/sixseven/${code}`;
    setInviteUrl(url);
    QRCode.toDataURL(url, {
      width: 256,
      margin: 1,
      color: { dark: "#f4f4f5", light: "#0000" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [router.isReady, code]);

  useEffect(() => {
    if (!router.isReady || !code) return;

    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (cancelled) return;
      const clientId = getClientId();
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/api/ws?code=${encodeURIComponent(
        code,
      )}&clientId=${encodeURIComponent(clientId)}`;
      setConn(attempt === 0 ? "connecting" : "reconnecting");

      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConn("online");
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "joined") setRole(msg.role);
          else if (msg.type === "state") setServer(msg);
          else if (msg.type === "error") setFatalError(msg.message);
        } catch {}
      };
      ws.onerror = () => {
        // close fires next; handle there
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (cancelled) return;
        if (fatalError) {
          setConn("failed");
          return;
        }
        attempt += 1;
        if (attempt > MAX_RECONNECT_ATTEMPTS) {
          setConn("failed");
          return;
        }
        const delay = Math.min(5000, 250 * 2 ** (attempt - 1));
        setConn("reconnecting");
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {}
    };
    // fatalError intentionally excluded — we check via closure ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, code]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
        tmp.getTracks().forEach((t) => t.stop());
        const devices = await navigator.mediaDevices.enumerateDevices();
        const vids = devices.filter((d) => d.kind === "videoinput");
        if (cancelled) return;
        setCameras(vids);
        if (vids[0]) setCamId(vids[0].deviceId);
        const lm = await createHandLandmarker();
        if (cancelled) {
          lm.close();
          return;
        }
        landmarkerRef.current = lm;
        setReady(true);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const attachCamera = useCallback(async (deviceId: string) => {
    const videoEl = videoRef.current;
    if (!deviceId || !videoEl) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      videoEl.srcObject = stream;
      await videoEl.play().catch(() => {});
    } catch (e) {
      console.error("camera error", e);
    }
  }, []);

  useEffect(() => {
    attachCamera(camId);
  }, [camId, attachCamera]);

  useEffect(() => {
    if (!ready) return;

    const drawHands = (
      ctx: CanvasRenderingContext2D,
      hands: LandmarkPoint[][],
      w: number,
      h: number,
      color: string,
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(3, w / 240);
      ctx.fillStyle = "#ffffff";
      for (const lms of hands) {
        for (const [a, b] of HAND_CONNECTIONS) {
          ctx.beginPath();
          ctx.moveTo(lms[a].x * w, lms[a].y * h);
          ctx.lineTo(lms[b].x * w, lms[b].y * h);
          ctx.stroke();
        }
        for (const lm of lms) {
          ctx.beginPath();
          ctx.arc(lm.x * w, lm.y * h, Math.max(4, w / 200), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const loop = () => {
      const videoEl = videoRef.current;
      const canvasEl = canvasRef.current;
      const landmarker = landmarkerRef.current;
      rafRef.current = requestAnimationFrame(loop);
      if (!videoEl || !canvasEl || !landmarker) return;
      if (videoEl.readyState < 2 || !videoEl.videoWidth) return;

      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      let result: DetectionResult;
      try {
        result = landmarker.detectForVideo(videoEl, ts);
      } catch {
        return;
      }

      const w = videoEl.videoWidth;
      const h = videoEl.videoHeight;
      if (canvasEl.width !== w) canvasEl.width = w;
      if (canvasEl.height !== h) canvasEl.height = h;
      const ctx = canvasEl.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      drawHands(ctx, result.landmarks, w, h, "#a78bfa");

      const next = classifySeesaw(result.landmarks);
      setStatus(next);

      if (next.kind === "tilt") {
        const prev = lastHigherRef.current;
        const now = performance.now();
        if (
          runningRef.current &&
          prev !== null &&
          next.higher !== prev &&
          now > cooldownUntilRef.current
        ) {
          cooldownUntilRef.current = now + SCORE_COOLDOWN_MS;
          if (wsRef.current?.readyState === 1) {
            wsRef.current.send(JSON.stringify({ type: "score" }));
          }
        }
        lastHigherRef.current = next.higher;
      }
    };
    loop();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [ready]);

  const sendStart = () => {
    if (wsRef.current?.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: "start" }));
    lastHigherRef.current = null;
    cooldownUntilRef.current = 0;
  };

  const sendReset = () => {
    if (wsRef.current?.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: "reset" }));
    lastHigherRef.current = null;
    cooldownUntilRef.current = 0;
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch {}
  };

  const peers = server?.peers ?? { host: "empty" as PeerStatus, guest: "empty" as PeerStatus };
  const opponentStatus: PeerStatus = role === "host" ? peers.guest : peers.host;
  const opponentReady = opponentStatus === "online";
  const opponentLabel =
    opponentStatus === "online" ? "" :
    opponentStatus === "reconnecting" ? " (reconnecting…)" :
    " (waiting…)";

  const myIdx = role === "host" ? 0 : 1;
  const oppIdx = role === "host" ? 1 : 0;
  const myScore = server?.scores[myIdx] ?? 0;
  const oppScore = server?.scores[oppIdx] ?? 0;
  const gameStatus: GameStatus = server?.status ?? "waiting";
  const timeLeft = server?.timeLeft ?? 60;
  const winner = server?.winner ?? null;

  const youWon = winner !== null && winner === myIdx;
  const youLost = winner !== null && winner === oppIdx;
  const tied = gameStatus === "finished" && winner === null;

  const showInvite = role === "host" && peers.guest === "empty";

  const statusText = (s: SeesawStatus) => {
    switch (s.kind) {
      case "waiting": return "Show both hands";
      case "closed":  return "Open your palms";
      case "level":   return "Level — keep swinging";
      case "tilt":    return s.higher === "left" ? "↖ left up" : "right up ↗";
    }
  };

  const connPill = (() => {
    switch (conn) {
      case "online":       return null;
      case "connecting":   return { tone: "blue", text: "Connecting…" };
      case "reconnecting": return { tone: "amber", text: "Reconnecting…" };
      case "failed":       return { tone: "red", text: "Disconnected" };
    }
  })();

  return (
    <>
      <Head>
        <title>{`six seven · ${code}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 sm:p-6">
        <div className="max-w-5xl mx-auto">
          <header className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-3">
              <Link href="/sixseven" className="text-zinc-500 hover:text-zinc-200 text-sm">
                ← Leave
              </Link>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
                    six seven
                  </span>
                </h1>
                <div className="text-xs uppercase tracking-widest text-zinc-500 flex items-center gap-2 mt-0.5">
                  <span>Room <span className="text-zinc-200 font-mono">{code}</span></span>
                  {role && <span className="text-zinc-200">· you are {role}</span>}
                  {connPill && (
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                        connPill.tone === "red"
                          ? "bg-red-500/20 text-red-300"
                          : connPill.tone === "amber"
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-blue-500/20 text-blue-300"
                      }`}
                    >
                      {connPill.text}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div
                className={`text-3xl sm:text-4xl font-mono tabular-nums px-4 py-2 rounded-lg border ${
                  timeLeft <= 10 && gameStatus === "running"
                    ? "border-red-500/60 text-red-300 animate-pulse"
                    : "border-zinc-800 text-zinc-100"
                }`}
              >
                {formatTime(timeLeft)}
              </div>
              {role === "host" && gameStatus !== "running" && (
                <button
                  onClick={sendStart}
                  disabled={!opponentReady || !ready || conn !== "online"}
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-bold text-black"
                >
                  {gameStatus === "finished" ? "Play again" : "Start"}
                </button>
              )}
              {role === "host" && (gameStatus === "running" || gameStatus === "finished") && (
                <button
                  onClick={sendReset}
                  className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold"
                >
                  Reset
                </button>
              )}
            </div>
          </header>

          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="rounded-xl p-4 bg-gradient-to-br from-cyan-500/20 to-blue-600/10 border border-cyan-500/30">
              <div className="text-xs uppercase tracking-widest text-cyan-300">You</div>
              <div className="text-5xl sm:text-6xl font-mono font-extrabold tabular-nums mt-1">
                {myScore}
              </div>
            </div>
            <div className="rounded-xl p-4 bg-gradient-to-br from-fuchsia-500/20 to-rose-600/10 border border-fuchsia-500/30">
              <div className="text-xs uppercase tracking-widest text-fuchsia-300">
                Opponent{opponentLabel}
              </div>
              <div className="text-5xl sm:text-6xl font-mono font-extrabold tabular-nums mt-1">
                {oppScore}
              </div>
            </div>
          </div>

          {fatalError && (
            <div className="mb-4 p-4 bg-red-950/40 border border-red-900 rounded-lg text-sm">
              {fatalError}
            </div>
          )}

          {loadError && (
            <div className="mb-4 p-4 bg-red-950/40 border border-red-900 rounded-lg text-sm">
              Could not start hand detection: {loadError}.
            </div>
          )}

          {!ready && !loadError && (
            <div className="mb-4 p-4 bg-blue-950/40 border border-blue-900 rounded-lg text-sm">
              Loading hand-tracking model… (grant camera access if prompted)
            </div>
          )}

          {gameStatus === "finished" && (
            <div className="mb-4 p-6 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/50 rounded-xl text-center">
              <div className="text-xs uppercase tracking-[0.2em] text-amber-300">Game over</div>
              <div className="text-4xl sm:text-5xl font-bold mt-2">
                {tied ? "It's a tie!" : youWon ? "You win!" : youLost ? "You lose" : ""}
              </div>
              <div className="mt-2 text-zinc-300 font-mono">
                {myScore} – {oppScore}
              </div>
            </div>
          )}

          <div className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900/60">
            <div className="relative aspect-video bg-black">
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className="absolute inset-0 w-full h-full object-cover -scale-x-100"
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full -scale-x-100"
              />
              <div className="absolute top-2 left-2 text-xs px-2 py-1 bg-black/70 rounded font-mono">
                {statusText(status)}
              </div>
              {status.kind === "tilt" && (
                <div className="absolute inset-x-0 bottom-3 flex justify-around items-end pointer-events-none">
                  <div
                    className={`text-5xl sm:text-6xl transition-transform ${
                      status.higher === "left" ? "-translate-y-3" : "translate-y-3 opacity-60"
                    }`}
                  >
                    ✋
                  </div>
                  <div
                    className={`text-5xl sm:text-6xl transition-transform ${
                      status.higher === "right" ? "-translate-y-3" : "translate-y-3 opacity-60"
                    }`}
                  >
                    ✋
                  </div>
                </div>
              )}

              {showInvite && (
                <div className="absolute inset-0 bg-black/85 flex items-center justify-center -scale-x-100">
                  <div className="-scale-x-100 max-w-sm w-full p-6 text-center">
                    <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">
                      Waiting for opponent
                    </div>
                    <div className="text-2xl font-bold mt-1 mb-4">Share this room</div>
                    {qrDataUrl && (
                      <img
                        src={qrDataUrl}
                        alt="Invite QR"
                        className="w-56 h-56 mx-auto mb-4 rounded-lg"
                      />
                    )}
                    <div className="font-mono text-3xl tracking-[0.4em] mb-3 text-zinc-100">
                      {code}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={inviteUrl}
                        className="flex-1 px-3 py-2 text-xs bg-zinc-900 border border-zinc-700 rounded font-mono truncate"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <button
                        onClick={copyInvite}
                        className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-xs font-bold"
                      >
                        {copyState === "copied" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="p-3 flex flex-wrap items-center gap-3">
              <label className="text-xs uppercase tracking-wider text-zinc-500">Camera</label>
              <select
                value={camId}
                onChange={(e) => setCamId(e.target.value)}
                className="flex-1 min-w-[200px] bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
              >
                {cameras.length === 0 && <option value="">No cameras found</option>}
                {cameras.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || `Camera ${c.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-5 p-4 bg-zinc-900/40 border border-zinc-800 rounded-lg text-sm text-zinc-400">
            <div className="font-semibold text-zinc-200 mb-2">How to play</div>
            <ul className="space-y-1 list-disc list-inside">
              <li>Both players join the same room (scan the QR or visit the link).</li>
              <li>Host taps <span className="font-semibold text-zinc-100">Start</span> once the opponent is in.</li>
              <li>Hold both palms up to your camera and do the <span className="font-semibold text-zinc-100">six seven</span> seesaw — one hand up, the other down, alternating.</li>
              <li>Every swap = +1. Most points when the timer hits 0 wins.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
