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
const BARK_FX_MS = 600;
const MAX_RECONNECT_ATTEMPTS = 12;

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

  return (
    <>
      <Head>
        <title>{`bark battle · ${code}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-gradient-to-b from-amber-800 via-orange-800 to-amber-950 text-zinc-100 p-3 sm:p-5">
        <div className="max-w-5xl mx-auto">
          <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <Link href="/bark" className="text-amber-200/70 hover:text-amber-100 text-sm">
                ← Leave
              </Link>
              <div>
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
                  <span className="bg-gradient-to-r from-amber-200 to-orange-300 bg-clip-text text-transparent">
                    BARK BATTLE
                  </span>
                </h1>
                <div className="text-[11px] uppercase tracking-widest text-amber-200/60 flex items-center gap-2 mt-0.5">
                  <span>
                    Room <span className="text-amber-100 font-mono">{code}</span>
                  </span>
                  {role && <span className="text-amber-100">· {role}</span>}
                  {connPill && (
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                        connPill.tone === "red"
                          ? "bg-red-500/20 text-red-300"
                          : connPill.tone === "amber"
                            ? "bg-amber-500/20 text-amber-200"
                            : "bg-blue-500/20 text-blue-300"
                      }`}
                    >
                      {connPill.text}
                    </span>
                  )}
                </div>
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
                  className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-black uppercase tracking-wider text-amber-950"
                >
                  {gameStatus === "finished" ? "Again" : "Start"}
                </button>
              )}
              {role === "host" && (gameStatus === "running" || gameStatus === "finished") && (
                <button
                  onClick={sendReset}
                  className="px-4 py-2.5 bg-amber-950/60 hover:bg-amber-900 border border-amber-700/50 rounded-lg font-bold"
                >
                  Reset
                </button>
              )}
            </div>
          </header>

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mb-3">
            <div>
              <div className="flex items-baseline justify-between text-xs uppercase tracking-widest text-amber-200/70 mb-1">
                <span>You</span>
                <span className="font-mono text-amber-100">{myScore}</span>
              </div>
              <div className="h-3 rounded-full bg-amber-950/70 border border-amber-700/40 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-300 to-yellow-200 transition-all duration-200"
                  style={{ width: `${myPct}%` }}
                />
              </div>
            </div>
            <div
              className={`text-4xl sm:text-5xl font-black font-mono tabular-nums px-3 ${
                timeLeft <= 5 && gameStatus === "running"
                  ? "text-red-200 animate-pulse"
                  : "text-amber-100"
              }`}
            >
              {formatTime(timeLeft)}
            </div>
            <div>
              <div className="flex items-baseline justify-between text-xs uppercase tracking-widest text-amber-200/70 mb-1">
                <span className="font-mono text-amber-100">{oppScore}</span>
                <span>Opp{opponentLabel}</span>
              </div>
              <div className="h-3 rounded-full bg-amber-950/70 border border-amber-700/40 overflow-hidden flex justify-end">
                <div
                  className="h-full bg-gradient-to-l from-rose-300 to-orange-300 transition-all duration-200"
                  style={{ width: `${oppPct}%` }}
                />
              </div>
            </div>
          </div>

          {matchStatus !== 3 && gameStatus !== "running" && (
            <div className="mb-3 p-4 bg-amber-950/50 border border-amber-700/40 rounded-xl">
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
              ) : !bothFunded ? (
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
              ) : (
                <div className="text-sm text-amber-100/90">
                  Both wagers locked —{" "}
                  <span className="font-mono text-amber-50">{formatEther(pot)} MON</span> pot.{" "}
                  {role === "host" ? "Hit Start when ready." : "Waiting for host to start."}
                </div>
              )}
            </div>
          )}

          {fatalError && (
            <div className="mb-3 p-3 bg-red-950/60 border border-red-900 rounded-lg text-sm">
              {fatalError}
            </div>
          )}

          <div className="relative rounded-2xl overflow-hidden border-2 border-amber-700/60 bg-gradient-to-b from-orange-700 via-amber-800 to-amber-900 shadow-xl">
            <div
              className="relative h-[58vh] min-h-[360px]"
              style={{
                backgroundImage:
                  "radial-gradient(ellipse at 50% 90%, rgba(0,0,0,0.4) 0%, transparent 60%), repeating-linear-gradient(120deg, rgba(255,200,120,0.06) 0px, rgba(255,200,120,0.06) 2px, transparent 2px, transparent 8px)",
              }}
            >
              <div
                className="absolute inset-x-0 bottom-0 h-1/3"
                style={{
                  background:
                    "linear-gradient(to top, rgba(120,53,15,0.7), transparent), radial-gradient(ellipse at 30% 100%, rgba(254,215,170,0.25), transparent 60%), radial-gradient(ellipse at 70% 100%, rgba(254,215,170,0.25), transparent 60%)",
                }}
              />

              <div
                className="absolute left-[8%] sm:left-[14%] bottom-[14%] select-none"
                style={{
                  transform: `scale(${myBarking ? 1.18 : 1}) translateX(${myBarking ? 6 : 0}px)`,
                  transition: "transform 120ms ease-out",
                  filter: myBarking ? "drop-shadow(0 0 24px rgba(253, 224, 71, 0.7))" : "none",
                }}
              >
                <div className="text-[120px] sm:text-[160px] leading-none">🐕</div>
                {myBarking && (
                  <div
                    className="absolute -top-12 sm:-top-16 left-1/2 -translate-x-1/2 px-4 py-1 bg-yellow-200 text-amber-950 font-black rounded-full border-4 border-amber-900 text-2xl sm:text-3xl tracking-wider"
                    style={{
                      transform: `rotate(-6deg) scale(${1 + (1 - mySinceBark / BARK_FX_MS) * 0.2})`,
                    }}
                  >
                    BARK!
                  </div>
                )}
                <div className="mt-1 text-[10px] uppercase tracking-widest text-amber-100/80 text-center">
                  You
                </div>
              </div>

              <div
                className="absolute right-[8%] sm:right-[14%] bottom-[14%] select-none"
                style={{
                  transform: `scale(${oppBarking ? 1.18 : 1}) translateX(${oppBarking ? -6 : 0}px) scaleX(-1)`,
                  transition: "transform 120ms ease-out",
                  filter: oppBarking ? "drop-shadow(0 0 24px rgba(252, 165, 165, 0.7))" : "none",
                }}
              >
                <div className="text-[120px] sm:text-[160px] leading-none">🐶</div>
                {oppBarking && (
                  <div
                    className="absolute -top-12 sm:-top-16 left-1/2 -translate-x-1/2 px-4 py-1 bg-orange-200 text-amber-950 font-black rounded-full border-4 border-amber-900 text-2xl sm:text-3xl tracking-wider"
                    style={{
                      transform: `scaleX(-1) rotate(6deg) scale(${1 + (1 - oppSinceBark / BARK_FX_MS) * 0.2})`,
                    }}
                  >
                    BARK!
                  </div>
                )}
                <div className="mt-1 text-[10px] uppercase tracking-widest text-amber-100/80 text-center" style={{ transform: "scaleX(-1)" }}>
                  Opp
                </div>
              </div>

              {gameStatus === "waiting" && !showInvite && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/40 backdrop-blur px-6 py-3 rounded-xl border border-amber-700/40 text-amber-100 font-bold text-center">
                    {role === "host"
                      ? opponentReady
                        ? "Press Start when ready"
                        : "Waiting for opponent…"
                      : "Waiting for host to start…"}
                  </div>
                </div>
              )}

              {gameStatus === "running" && (audio !== "ready") && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-red-500/90 px-3 py-1 rounded-full text-xs font-bold">
                  Mic disabled
                </div>
              )}

              {gameStatus === "finished" && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-black/70 backdrop-blur rounded-2xl px-8 py-6 border-2 border-amber-300/80 text-center shadow-2xl">
                    <div className="text-amber-300 text-xs uppercase tracking-[0.3em] mb-1">
                      Time's up
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
                <div className="absolute inset-0 bg-black/85 flex items-center justify-center">
                  <div className="max-w-sm w-full p-6 text-center">
                    <div className="text-xs uppercase tracking-[0.2em] text-amber-200">
                      Waiting for opponent
                    </div>
                    <div className="text-2xl font-black mt-1 mb-4">Share this room</div>
                    {qrDataUrl && (
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

            <div className="p-3 bg-amber-950/60 border-t border-amber-700/40 flex items-center gap-3">
              <span className="text-[11px] uppercase tracking-widest text-amber-200/70 shrink-0">
                Mic
              </span>
              <div className="flex-1 h-3 bg-amber-950/80 rounded-full overflow-hidden border border-amber-700/40">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 via-yellow-300 to-rose-400 transition-all duration-75"
                  style={{ width: `${Math.min(100, level * 350)}%` }}
                />
              </div>
              {audio === "ready" && (
                <span className="text-[11px] font-mono text-amber-200/70">{level.toFixed(2)}</span>
              )}
              {audio !== "ready" && (
                <button
                  onClick={enableMic}
                  className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-amber-950 rounded text-xs font-bold"
                >
                  {audio === "denied" ? "Retry" : "Enable mic"}
                </button>
              )}
            </div>
          </div>

          {audioError && audio !== "ready" && (
            <div className="mt-3 p-3 bg-red-950/60 border border-red-900 rounded-lg text-sm">
              Mic error: {audioError}
            </div>
          )}

          <div className="mt-4 p-3 bg-amber-950/40 border border-amber-700/40 rounded-lg text-sm text-amber-100/80">
            <div className="font-bold text-amber-100 mb-1">How to play</div>
            <ul className="space-y-1 list-disc list-inside">
              <li>Both players join the same room (scan QR or use the code).</li>
              <li>Host taps <span className="font-bold text-amber-100">Start</span> once the opponent connects.</li>
              <li>Bark, woof, shout — short loud sounds in the dog/voice range score points.</li>
              <li>Most barks when the timer hits 0:00 takes the K.O.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
