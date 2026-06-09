import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { formatEther, parseEther } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { VAULT_ABI, VAULT_ADDRESS, matchIdFromCode } from "@/lib/contracts";

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

  // ---- On-chain wager (vault escrow) ----
  const { isConnected } = useAccount();
  const matchId = code ? matchIdFromCode(code) : undefined;
  const { data: matchRaw, refetch: refetchMatch } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "getMatch",
    args: matchId ? [matchId] : undefined,
    query: {
      enabled: Boolean(matchId),
      // Poll fast (1.2s) while a match is Open/Funded so the payout shows up
      // quickly once the resolver settles; idle slower otherwise.
      refetchInterval: (q) => {
        const data = q.state.data as readonly unknown[] | undefined;
        const s = Number((data?.[4] as number | undefined) ?? 0);
        return s === 1 || s === 2 ? 1200 : 4000;
      },
    },
  });
  const { writeContractAsync, isPending: writePending } = useWriteContract();
  const [wager, setWager] = useState("0.1");
  const [pendingTx, setPendingTx] = useState<`0x${string}` | undefined>(undefined);
  const { isLoading: txMining, isSuccess: txDone } = useWaitForTransactionReceipt({
    hash: pendingTx,
    query: { enabled: Boolean(pendingTx) },
  });

  useEffect(() => {
    if (txDone) {
      refetchMatch();
      setPendingTx(undefined);
    }
  }, [txDone, refetchMatch]);

  const match = matchRaw as
    | readonly [`0x${string}`, `0x${string}`, bigint, bigint, number]
    | undefined;
  const matchStatus = Number(match?.[4] ?? 0); // 0 None 1 Open 2 Funded 3 Resolved 4 Cancelled
  const hostStake = match?.[2] ?? 0n;
  const guestStake = match?.[3] ?? 0n;
  const pot = hostStake + guestStake;
  const bothFunded = matchStatus === 2;
  const iStaked = role === "host" ? matchStatus >= 1 : matchStatus >= 2;
  const txBusy = writePending || txMining;

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
      color: { dark: "#fef3c7", light: "#0000" },
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

  const lockWager = async () => {
    if (!matchId || !isConnected || !role) return;
    let value: bigint;
    try {
      value = parseEther(wager || "0");
    } catch {
      return;
    }
    if (value <= 0n) return;
    try {
      const hash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: role === "host" ? "createMatch" : "joinMatch",
        args: [matchId],
        value,
      });
      setPendingTx(hash);
    } catch {
      /* user rejected or tx reverted */
    }
  };

  const cancelWager = async () => {
    if (!matchId) return;
    try {
      const hash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "cancel",
        args: [matchId],
      });
      setPendingTx(hash);
    } catch {
      /* ignore */
    }
  };

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
  const timeLeft = server?.timeLeft ?? 20;
  const winner = server?.winner ?? null;

  const youWon = winner !== null && winner === myIdx;
  const youLost = winner !== null && winner === oppIdx;
  const tied = gameStatus === "finished" && winner === null;

  const showInvite = role === "host" && peers.guest === "empty";

  const totalSwaps = myScore + oppScore;
  const leftShare =
    totalSwaps === 0
      ? 50
      : Math.max(5, Math.min(95, (myScore / totalSwaps) * 100));

  const showWagerPanel =
    matchStatus !== 3 && gameStatus !== "running" && !showInvite && !bothFunded;

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
        <title>{`What's 67? · ${code}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="fixed inset-0 overflow-hidden bg-gradient-to-b from-amber-900 via-orange-800 to-amber-950 text-zinc-100 select-none">
        <header className="absolute top-0 inset-x-0 z-30 px-3 sm:px-6 py-3 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex items-center gap-2">
            <Link
              href="/sixseven"
              className="bg-black/50 hover:bg-black/70 backdrop-blur border border-white/15 px-3 py-1.5 rounded-lg text-amber-100 text-sm font-bold"
            >
              ← Leave
            </Link>
            <div className="hidden sm:flex items-center gap-2 bg-black/50 backdrop-blur border border-white/15 px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-widest text-amber-100/90">
              <span>
                Room <span className="text-amber-200 font-mono">{code}</span>
              </span>
              {role && <span className="text-amber-200">· {role}</span>}
              {connPill && (
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                    connPill.tone === "red"
                      ? "bg-red-500/30 text-red-200"
                      : connPill.tone === "amber"
                        ? "bg-amber-500/30 text-amber-100"
                        : "bg-blue-500/30 text-blue-200"
                  }`}
                >
                  {connPill.text}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {role === "host" && gameStatus !== "running" && (
              <button
                onClick={sendStart}
                disabled={!opponentReady || !ready || conn !== "online" || !bothFunded}
                title={!bothFunded ? "Both players must lock a wager first" : undefined}
                className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-black uppercase tracking-wider text-amber-950 shadow-lg"
              >
                {gameStatus === "finished" ? "Again" : "Start"}
              </button>
            )}
            {role === "host" && (gameStatus === "running" || gameStatus === "finished") && (
              <button
                onClick={sendReset}
                className="px-4 py-2.5 bg-black/50 hover:bg-black/70 backdrop-blur border border-white/20 rounded-lg font-bold text-amber-100"
              >
                Reset
              </button>
            )}
          </div>
        </header>

        <div className="absolute top-[68px] sm:top-20 inset-x-0 z-20 flex flex-col items-center pointer-events-none">
          <div className="w-[82%] max-w-lg relative">
            <div className="relative h-4 rounded-full overflow-hidden border-2 border-amber-950 bg-white/30 shadow">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-600 via-amber-400 to-yellow-200 transition-[width] duration-200"
                style={{ width: `${leftShare}%` }}
              />
              <div
                className="absolute inset-y-0 right-0 bg-gradient-to-l from-slate-500 via-slate-300 to-slate-100 transition-[width] duration-200"
                style={{ width: `${100 - leftShare}%` }}
              />
            </div>
            <div
              className="absolute top-1/2 w-5 h-5 -mt-2.5 -ml-2.5 rounded-full bg-white border-2 border-amber-950 shadow-md transition-[left] duration-200"
              style={{ left: `${leftShare}%` }}
            />
          </div>
          <div
            className={`mt-2 text-5xl sm:text-7xl font-black tabular-nums drop-shadow-[0_3px_0_rgba(0,0,0,0.55)] ${
              timeLeft <= 5 && gameStatus === "running"
                ? "text-red-200 animate-pulse"
                : "text-white"
            }`}
          >
            {timeLeft}
          </div>
          <div className="mt-1 flex items-center gap-5 text-[11px] uppercase tracking-widest text-white drop-shadow">
            <span>
              You <span className="font-mono text-amber-200 ml-1">{myScore}</span>
            </span>
            <span>
              Opp{opponentLabel}
              <span className="font-mono text-amber-200 ml-1">{oppScore}</span>
            </span>
          </div>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 bottom-[88px] sm:bottom-[96px] top-[200px] sm:top-[240px] z-10 w-[92%] max-w-3xl flex items-center">
          <div className="w-full rounded-2xl overflow-hidden border-2 border-amber-300/60 bg-black/40 shadow-2xl">
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
              <div className="absolute top-2 left-2 text-xs px-2 py-1 bg-black/70 rounded font-mono text-amber-100">
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
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 inset-x-0 z-20 px-3 sm:px-6 py-3 bg-gradient-to-t from-black/70 to-transparent flex items-center gap-3">
          <label className="text-[11px] uppercase tracking-widest text-amber-100 shrink-0 drop-shadow">
            Camera
          </label>
          <select
            value={camId}
            onChange={(e) => setCamId(e.target.value)}
            className="flex-1 min-w-[160px] bg-black/40 border border-white/20 backdrop-blur rounded-lg px-3 py-1.5 text-sm text-amber-100 focus:outline-none focus:border-amber-400"
          >
            {cameras.length === 0 && <option value="">No cameras found</option>}
            {cameras.map((c) => (
              <option key={c.deviceId} value={c.deviceId} className="text-zinc-900">
                {c.label || `Camera ${c.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>

        {gameStatus === "running" && !ready && (
          <div className="absolute top-[180px] left-1/2 -translate-x-1/2 z-20 bg-red-500/90 px-3 py-1 rounded-full text-xs font-bold">
            Camera not ready
          </div>
        )}

        {fatalError && (
          <div className="absolute top-[180px] left-1/2 -translate-x-1/2 z-30 p-3 bg-red-950/80 backdrop-blur border border-red-900 rounded-lg text-sm max-w-md text-center">
            {fatalError}
          </div>
        )}

        {loadError && (
          <div className="absolute top-[180px] left-1/2 -translate-x-1/2 z-30 p-3 bg-red-950/80 backdrop-blur border border-red-900 rounded-lg text-sm max-w-md text-center">
            Could not start hand detection: {loadError}.
          </div>
        )}

        {!ready && !loadError && !fatalError && (
          <div className="absolute top-[180px] left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-black/60 backdrop-blur border border-white/20 rounded-lg text-sm text-amber-100 max-w-md text-center">
            Loading hand-tracking model… (grant camera access if prompted)
          </div>
        )}

        {gameStatus === "waiting" && !showInvite && !showWagerPanel && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="bg-black/50 backdrop-blur px-6 py-3 rounded-xl border border-white/20 text-amber-100 font-bold text-center">
              {role === "host"
                ? opponentReady
                  ? "Press Start when ready"
                  : "Waiting for opponent…"
                : "Waiting for host to start…"}
            </div>
          </div>
        )}

        {showWagerPanel && (
          <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-30 w-[92%] max-w-md">
            <div className="p-4 bg-amber-950/95 backdrop-blur border border-amber-700/60 rounded-xl shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs uppercase tracking-widest text-amber-200/70">
                  Wager · winner takes all
                </div>
                {bothFunded && (
                  <div className="text-emerald-300 text-sm font-bold font-mono">
                    Pot {formatEther(pot)} MON
                  </div>
                )}
              </div>

              {!isConnected ? (
                <div className="text-sm text-amber-200/70">
                  Connect your wallet to place a wager.
                </div>
              ) : !iStaked ? (
                role === "guest" && matchStatus === 0 ? (
                  <div className="text-sm text-amber-200/70">
                    Waiting for the host to set the stake…
                  </div>
                ) : (
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={wager}
                        onChange={(e) => setWager(e.target.value)}
                        className="w-full px-4 py-3 bg-amber-950/70 border border-amber-700/50 rounded-lg font-mono text-lg pr-16 focus:outline-none focus:border-amber-400"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-amber-200/60 text-sm font-mono">
                        MON
                      </span>
                    </div>
                    <button
                      onClick={lockWager}
                      disabled={txBusy}
                      className="px-5 py-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-black uppercase tracking-wider text-amber-950 whitespace-nowrap"
                    >
                      {txBusy ? "Locking…" : role === "host" ? "Stake & host" : "Stake & join"}
                    </button>
                  </div>
                )
              ) : (
                <div className="text-sm text-amber-100/90">
                  You staked{" "}
                  <span className="font-mono text-amber-50">
                    {formatEther(role === "host" ? hostStake : guestStake)} MON
                  </span>
                  . Waiting for your opponent to match…
                  {role === "host" && matchStatus === 1 && (
                    <button
                      onClick={cancelWager}
                      disabled={txBusy}
                      className="ml-3 text-amber-200/70 underline hover:text-amber-100 disabled:opacity-40"
                    >
                      cancel &amp; refund
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {gameStatus === "finished" && (
          <div className="absolute inset-0 z-40 flex items-center justify-center">
            <div className="bg-black/70 backdrop-blur rounded-2xl px-8 py-6 border-2 border-amber-300/80 text-center shadow-2xl">
              <div className="text-amber-300 text-xs uppercase tracking-[0.3em] mb-1">
                Time&apos;s up
              </div>
              <div className="text-5xl sm:text-6xl font-black mb-1">
                {tied ? "TIE" : youWon ? "YOU WIN!" : youLost ? "YOU LOSE" : ""}
              </div>
              <div className="font-mono text-amber-200/80">
                {myScore} – {oppScore}
              </div>
              {pot > 0n && (
                <div className="mt-2 text-sm">
                  {matchStatus === 3 ? (
                    tied ? (
                      <span className="text-emerald-300">Tie — stakes refunded.</span>
                    ) : (
                      <span className="text-emerald-300">
                        Pot {formatEther(pot)} MON paid out · Six Seven Master minted 🏆
                      </span>
                    )
                  ) : (
                    <span className="text-amber-200">Settling on-chain…</span>
                  )}
                </div>
              )}
              <Link
                href="/sixseven"
                className="inline-block mt-4 px-4 py-2 bg-black/50 hover:bg-black/70 border border-white/20 rounded-lg text-sm font-bold text-amber-100"
              >
                New match
              </Link>
            </div>
          </div>
        )}

        {showInvite && (
          <div className="absolute inset-0 z-40 bg-black/85 flex items-center justify-center">
            <div className="max-w-sm w-full p-6 text-center">
              <div className="text-xs uppercase tracking-[0.2em] text-amber-200">
                Waiting for opponent
              </div>
              <div className="text-2xl font-black mt-1 mb-4">Share this room</div>
              {qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="Invite QR"
                  className="w-56 h-56 mx-auto mb-4 rounded-lg bg-amber-900/40 p-2"
                />
              )}
              <div className="font-mono text-3xl tracking-[0.4em] mb-3 text-amber-100">
                {code}
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className="flex-1 px-3 py-2 text-xs bg-amber-950/80 border border-amber-700/60 rounded font-mono truncate"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  onClick={copyInvite}
                  className="px-3 py-2 bg-amber-700/80 hover:bg-amber-600 rounded text-xs font-bold"
                >
                  {copyState === "copied" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
