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
import { BARK_VAULT_ADDRESS, VAULT_ABI, matchIdFromCode } from "@/lib/contracts";

type Role = "host" | "guest";
type GameStatus = "waiting" | "running" | "finished";
type PeerStatus = "online" | "reconnecting" | "empty";
type ConnState = "connecting" | "online" | "reconnecting" | "failed";
type AudioState = "idle" | "requesting" | "ready" | "denied" | "suspended" | "error";

type ServerState = {
  scores: [number, number];
  timeLeft: number;
  status: GameStatus;
  winner: number | null;
  peers: { host: PeerStatus; guest: PeerStatus };
};

const BARK_WS_URL_OVERRIDE = process.env.NEXT_PUBLIC_BARK_WS_URL ?? "";
const AMP_THRESHOLD = 0.16;
const HYSTERESIS_LOW = 0.045;
const FREQ_MIN = 100;
const FREQ_MAX = 4000;
const COOLDOWN_MS = 220;
const BARK_FX_MS = 320;
const BARK_BOUNCE_MS = 280;
const POP_LIFE_MS = 900;
const POP_MAX = 10;
const MAX_RECONNECT_ATTEMPTS = 12;

const BARK_WORDS = [
  "BARK!",
  "WOOF!",
  "ARF!",
  "RUFF!",
  "GRR!",
  "YIP!",
  "AWOO!",
  "BOW!",
  "YAP!",
  "BARK BARK!",
];

type Pop = {
  id: number;
  word: string;
  dx: number;
  dy: number;
  rot: number;
  scale: number;
  color: "yellow" | "orange";
};

let popIdCounter = 0;
function spawnPops(
  side: "left" | "right",
  count: number,
  color: "yellow" | "orange",
): Pop[] {
  return Array.from({ length: count }, () => {
    const angle = -150 + Math.random() * 120; // upper hemisphere
    const distance = 70 + Math.random() * 70;
    const rad = (angle * Math.PI) / 180;
    return {
      id: ++popIdCounter,
      word: BARK_WORDS[Math.floor(Math.random() * BARK_WORDS.length)],
      dx: Math.cos(rad) * distance * (side === "left" ? 1 : -1),
      dy: Math.sin(rad) * distance,
      rot: -25 + Math.random() * 50,
      scale: 0.85 + Math.random() * 0.55,
      color,
    };
  });
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function getClientId(): string {
  if (typeof window === "undefined") return "";
  const key = "bark-client-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    sessionStorage.setItem(key, id);
  }
  return id;
}

export default function BarkRoom() {
  const router = useRouter();
  const code = String(router.query.code ?? "").toUpperCase();

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const timeBufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const freqBufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number | null>(null);
  const barkingRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const runningRef = useRef(false);
  const lastOppScoreRef = useRef(0);
  const lastMyScoreRef = useRef(0);
  const myDogRef = useRef<HTMLDivElement>(null);
  const oppDogRef = useRef<HTMLDivElement>(null);

  const [audio, setAudio] = useState<AudioState>("idle");
  const [audioError, setAudioError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const [role, setRole] = useState<Role | null>(null);
  const [server, setServer] = useState<ServerState | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  const [myBarkAt, setMyBarkAt] = useState(0);
  const [oppBarkAt, setOppBarkAt] = useState(0);
  const [myPops, setMyPops] = useState<Pop[]>([]);
  const [oppPops, setOppPops] = useState<Pop[]>([]);

  // ---- On-chain wager (bark vault escrow, no NFT) ----
  const { isConnected } = useAccount();
  const matchId = code ? matchIdFromCode(code) : undefined;
  const { data: matchRaw, refetch: refetchMatch } = useReadContract({
    address: BARK_VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "getMatch",
    args: matchId ? [matchId] : undefined,
    query: { enabled: Boolean(matchId), refetchInterval: 3000 },
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
    const url = `${window.location.origin}/bark/${code}`;
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
      const params = `?code=${encodeURIComponent(code)}&clientId=${encodeURIComponent(clientId)}`;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = BARK_WS_URL_OVERRIDE
        ? `${BARK_WS_URL_OVERRIDE.replace(/\/$/, "")}${params}`
        : `${proto}//${window.location.host}/api/bark${params}`;
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
      ws.onerror = () => {};
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (cancelled) return;
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
  }, [router.isReady, code]);

  const enableMic = useCallback(async () => {
    setAudio("requesting");
    setAudioError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      micStreamRef.current = stream;

      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      analyserRef.current = analyser;
      timeBufRef.current = new Float32Array(analyser.fftSize);
      freqBufRef.current = new Float32Array(analyser.frequencyBinCount);

      setAudio(ctx.state === "running" ? "ready" : "suspended");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/permission|denied|NotAllowed/i.test(msg)) setAudio("denied");
      else setAudio("error");
      setAudioError(msg);
    }
  }, []);

  useEffect(() => {
    enableMic();
    return () => {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      micStreamRef.current = null;
      audioCtxRef.current = null;
      analyserRef.current = null;
    };
  }, [enableMic]);

  useEffect(() => {
    if (audio !== "ready") return;
    const analyser = analyserRef.current;
    const ctx = audioCtxRef.current;
    const timeBuf = timeBufRef.current;
    const freqBuf = freqBufRef.current;
    if (!analyser || !ctx || !timeBuf || !freqBuf) return;

    const sampleRate = ctx.sampleRate;

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      analyser.getFloatTimeDomainData(timeBuf);
      let sum = 0;
      for (let i = 0; i < timeBuf.length; i++) sum += timeBuf[i] * timeBuf[i];
      const rms = Math.sqrt(sum / timeBuf.length);

      analyser.getFloatFrequencyData(freqBuf);
      let maxBin = 0;
      let maxVal = -Infinity;
      for (let i = 0; i < freqBuf.length; i++) {
        if (freqBuf[i] > maxVal) {
          maxVal = freqBuf[i];
          maxBin = i;
        }
      }
      const freq = (maxBin * sampleRate) / analyser.fftSize;

      setLevel(rms);

      const inRange = freq >= FREQ_MIN && freq <= FREQ_MAX;
      const loud = rms >= AMP_THRESHOLD;
      const isBarking = loud && inRange;
      const now = performance.now();

      if (isBarking && !barkingRef.current && now > cooldownUntilRef.current) {
        barkingRef.current = true;
        cooldownUntilRef.current = now + COOLDOWN_MS;
        if (runningRef.current && wsRef.current?.readyState === 1) {
          wsRef.current.send(JSON.stringify({ type: "score" }));
        }
        setMyBarkAt(Date.now());
      } else if (barkingRef.current && rms < HYSTERESIS_LOW) {
        barkingRef.current = false;
      }
    };

    loop();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [audio]);

  useEffect(() => {
    if (!server) return;
    const myIdx = role === "host" ? 0 : 1;
    const oppIdx = 1 - myIdx;
    const myNow = server.scores[myIdx];
    const oppNow = server.scores[oppIdx];
    if (oppNow > lastOppScoreRef.current) setOppBarkAt(Date.now());
    if (myNow > lastMyScoreRef.current && Date.now() - myBarkAt > 100) {
      setMyBarkAt(Date.now());
    }
    lastOppScoreRef.current = oppNow;
    lastMyScoreRef.current = myNow;
  }, [server, role, myBarkAt]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const img = new window.Image();
    img.src = "/dogmad.png";
  }, []);

  useEffect(() => {
    if (myBarkAt === 0) return;
    const el = myDogRef.current;
    if (el) {
      el.style.animation = "none";
      void el.offsetWidth; // force reflow so the animation replays each bark
      el.style.animation = `dog-bark ${BARK_BOUNCE_MS}ms ease-out`;
    }
    const fresh = spawnPops("left", 2 + Math.floor(Math.random() * 2), "yellow");
    setMyPops((prev) => [...prev, ...fresh].slice(-POP_MAX));
    const t = setTimeout(() => {
      setMyPops((prev) => prev.filter((p) => !fresh.some((f) => f.id === p.id)));
    }, POP_LIFE_MS);
    return () => clearTimeout(t);
  }, [myBarkAt]);

  useEffect(() => {
    if (oppBarkAt === 0) return;
    const el = oppDogRef.current;
    if (el) {
      el.style.animation = "none";
      void el.offsetWidth; // force reflow so the animation replays each bark
      el.style.animation = `dog-bark ${BARK_BOUNCE_MS}ms ease-out`;
    }
    const fresh = spawnPops("right", 2 + Math.floor(Math.random() * 2), "orange");
    setOppPops((prev) => [...prev, ...fresh].slice(-POP_MAX));
    const t = setTimeout(() => {
      setOppPops((prev) => prev.filter((p) => !fresh.some((f) => f.id === p.id)));
    }, POP_LIFE_MS);
    return () => clearTimeout(t);
  }, [oppBarkAt]);

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
        address: BARK_VAULT_ADDRESS,
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
        address: BARK_VAULT_ADDRESS,
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
    barkingRef.current = false;
    cooldownUntilRef.current = 0;
  };

  const sendReset = () => {
    if (wsRef.current?.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: "reset" }));
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
    opponentStatus === "online"
      ? ""
      : opponentStatus === "reconnecting"
        ? " (reconnecting…)"
        : " (waiting…)";

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

  const connPill = (() => {
    switch (conn) {
      case "online":
        return null;
      case "connecting":
        return { tone: "blue", text: "Connecting…" };
      case "reconnecting":
        return { tone: "amber", text: "Reconnecting…" };
      case "failed":
        return { tone: "red", text: "Disconnected" };
    }
  })();

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const mySinceBark = now - myBarkAt;
  const oppSinceBark = now - oppBarkAt;
  const myBarking = mySinceBark < BARK_FX_MS;
  const oppBarking = oppSinceBark < BARK_FX_MS;
  void tick;

  const scoreMax = Math.max(20, myScore + 4, oppScore + 4);
  const myPct = Math.min(100, (myScore / scoreMax) * 100);
  const oppPct = Math.min(100, (oppScore / scoreMax) * 100);

  const totalBarks = myScore + oppScore;
  const leftShare =
    totalBarks === 0
      ? 50
      : Math.max(5, Math.min(95, (myScore / totalBarks) * 100));

  const showWagerPanel =
    matchStatus !== 3 && gameStatus !== "running" && !showInvite && !bothFunded;

  return (
    <>
      <Head>
        <title>{`bark battle · ${code}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div
        className="fixed inset-0 overflow-hidden bg-amber-900 text-zinc-100 select-none"
        style={{
          backgroundImage: "url('/dogbackground.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <header className="absolute top-0 inset-x-0 z-30 px-3 sm:px-6 py-3 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex items-center gap-2">
            <Link
              href="/bark"
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
                disabled={
                  !opponentReady || audio !== "ready" || conn !== "online" || !bothFunded
                }
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

        <div
          className="absolute left-[3%] sm:left-[8%] bottom-[18%] sm:bottom-[20%] z-10"
          style={{
            transform: `translateX(${myBarking ? 6 : 0}px)`,
            transition: "transform 100ms ease-out",
            filter: myBarking ? "drop-shadow(0 0 32px rgba(253, 224, 71, 0.85))" : "none",
          }}
        >
          {myBarking && (
            <>
              <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 sm:w-52 sm:h-52 rounded-full border-[5px] border-yellow-200/80 animate-ping" />
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 sm:w-40 sm:h-40 rounded-full border-4 border-amber-300/70 animate-ping"
                style={{ animationDelay: "140ms" }}
              />
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 sm:w-28 sm:h-28 rounded-full border-4 border-orange-300/60 animate-ping"
                style={{ animationDelay: "280ms" }}
              />
            </>
          )}

          <div ref={myDogRef} className="dog-bark-anim relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={myBarking ? "/dogmad.png" : "/dog.png"}
              alt="you"
              draggable={false}
              className={`h-auto pointer-events-none ${
                myBarking ? "w-56 sm:w-96" : "w-44 sm:w-72"
              }`}
            />
          </div>

          {myPops.map((p) => (
            <div
              key={p.id}
              className="absolute top-0 left-1/2 pointer-events-none"
              style={{
                transform: `translate(calc(-50% + ${p.dx}px), ${p.dy}px) rotate(${p.rot}deg)`,
              }}
            >
              <span
                className={`bark-pop inline-block px-3 py-0.5 font-black text-amber-950 text-lg sm:text-2xl rounded-full border-[3px] border-amber-900 whitespace-nowrap shadow ${
                  p.color === "yellow" ? "bg-yellow-200" : "bg-orange-200"
                }`}
                style={{ ["--pop-scale" as unknown as string]: p.scale }}
              >
                {p.word}
              </span>
            </div>
          ))}
        </div>

        <div
          className="absolute right-[3%] sm:right-[8%] bottom-[18%] sm:bottom-[20%] z-10"
          style={{
            transform: `translateX(${oppBarking ? -6 : 0}px)`,
            transition: "transform 100ms ease-out",
            filter: oppBarking ? "drop-shadow(0 0 32px rgba(252, 165, 165, 0.85))" : "none",
          }}
        >
          {oppBarking && (
            <>
              <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 sm:w-52 sm:h-52 rounded-full border-[5px] border-rose-200/80 animate-ping" />
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 sm:w-40 sm:h-40 rounded-full border-4 border-orange-200/70 animate-ping"
                style={{ animationDelay: "140ms" }}
              />
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 sm:w-28 sm:h-28 rounded-full border-4 border-amber-200/60 animate-ping"
                style={{ animationDelay: "280ms" }}
              />
            </>
          )}

          <div ref={oppDogRef} className="dog-bark-anim relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={oppBarking ? "/dogmad.png" : "/dog.png"}
              alt="opp"
              draggable={false}
              className={`h-auto pointer-events-none ${
                oppBarking ? "w-56 sm:w-96" : "w-44 sm:w-72"
              }`}
              style={{ transform: "scaleX(-1)" }}
            />
          </div>

          {oppPops.map((p) => (
            <div
              key={p.id}
              className="absolute top-0 left-1/2 pointer-events-none"
              style={{
                transform: `translate(calc(-50% + ${p.dx}px), ${p.dy}px) rotate(${p.rot}deg)`,
              }}
            >
              <span
                className={`bark-pop inline-block px-3 py-0.5 font-black text-amber-950 text-lg sm:text-2xl rounded-full border-[3px] border-amber-900 whitespace-nowrap shadow ${
                  p.color === "yellow" ? "bg-yellow-200" : "bg-orange-200"
                }`}
                style={{ ["--pop-scale" as unknown as string]: p.scale }}
              >
                {p.word}
              </span>
            </div>
          ))}
        </div>

        <div className="absolute bottom-0 inset-x-0 z-20 px-3 sm:px-6 py-3 bg-gradient-to-t from-black/70 to-transparent flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-widest text-amber-100 shrink-0 drop-shadow">
            Mic
          </span>
          <div className="flex-1 h-3 bg-black/40 rounded-full overflow-hidden border border-white/20 backdrop-blur">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 via-yellow-300 to-rose-400 transition-all duration-75"
              style={{ width: `${Math.min(100, level * 350)}%` }}
            />
          </div>
          {audio === "ready" ? (
            <span className="text-[11px] font-mono text-amber-100 drop-shadow w-10 text-right">
              {level.toFixed(2)}
            </span>
          ) : (
            <button
              onClick={enableMic}
              className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-amber-950 rounded text-xs font-bold"
            >
              {audio === "denied" ? "Retry mic" : "Enable mic"}
            </button>
          )}
        </div>

        {gameStatus === "running" && audio !== "ready" && (
          <div className="absolute top-[180px] left-1/2 -translate-x-1/2 z-20 bg-red-500/90 px-3 py-1 rounded-full text-xs font-bold">
            Mic disabled
          </div>
        )}

        {fatalError && (
          <div className="absolute top-[180px] left-1/2 -translate-x-1/2 z-20 p-3 bg-red-950/80 backdrop-blur border border-red-900 rounded-lg text-sm max-w-md text-center">
            {fatalError}
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
                {tied ? "TIE" : youWon ? "K.O. WIN!" : youLost ? "K.O. LOSS" : ""}
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
                        Pot {formatEther(pot)} MON paid out 🏆
                      </span>
                    )
                  ) : (
                    <span className="text-amber-200">Settling on-chain…</span>
                  )}
                </div>
              )}
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

        <style jsx global>{`
          @keyframes bark-pop {
            0% {
              opacity: 0;
              transform: scale(calc(var(--pop-scale, 1) * 0.3));
            }
            18% {
              opacity: 1;
              transform: scale(calc(var(--pop-scale, 1) * 1.35));
            }
            72% {
              opacity: 1;
              transform: scale(calc(var(--pop-scale, 1) * 1));
            }
            100% {
              opacity: 0;
              transform: scale(calc(var(--pop-scale, 1) * 0.95)) translateY(-32px);
            }
          }
          .bark-pop {
            display: inline-block;
            transform-origin: center;
            animation: bark-pop ${POP_LIFE_MS}ms ease-out forwards;
          }
          @keyframes dog-bark {
            0% {
              transform: scale(1);
            }
            38% {
              transform: scale(1.28);
            }
            100% {
              transform: scale(1);
            }
          }
          .dog-bark-anim {
            transform-origin: bottom center;
          }
        `}</style>
      </div>
    </>
  );
}
