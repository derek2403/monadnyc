import Head from "next/head";
import { useCallback, useEffect, useRef, useState } from "react";

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

const VISION_BUNDLE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs";
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const GAME_DURATION = 60;
const SCORE_COOLDOWN_MS = 220;
const TILT_THRESHOLD = 0.07;

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

type PlayerInternal = {
  score: number;
  lastHigher: HandSide | null;
  cooldownUntil: number;
};

export default function Battle() {
  const video1Ref = useRef<HTMLVideoElement>(null);
  const video2Ref = useRef<HTMLVideoElement>(null);
  const canvas1Ref = useRef<HTMLCanvasElement>(null);
  const canvas2Ref = useRef<HTMLCanvasElement>(null);
  const landmarker1Ref = useRef<HandLandmarkerInstance | null>(null);
  const landmarker2Ref = useRef<HandLandmarkerInstance | null>(null);
  const stream1Ref = useRef<MediaStream | null>(null);
  const stream2Ref = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTs1Ref = useRef(0);
  const lastTs2Ref = useRef(0);

  const runningRef = useRef(false);
  const p1Ref = useRef<PlayerInternal>({ score: 0, lastHigher: null, cooldownUntil: 0 });
  const p2Ref = useRef<PlayerInternal>({ score: 0, lastHigher: null, cooldownUntil: 0 });

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cam1, setCam1] = useState("");
  const [cam2, setCam2] = useState("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [gameOver, setGameOver] = useState(false);
  const [score1, setScore1] = useState(0);
  const [score2, setScore2] = useState(0);
  const [status1, setStatus1] = useState<SeesawStatus>({ kind: "waiting" });
  const [status2, setStatus2] = useState<SeesawStatus>({ kind: "waiting" });

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
        if (vids[0]) setCam1(vids[0].deviceId);
        setCam2((vids[1] ?? vids[0])?.deviceId ?? "");

        const [l1, l2] = await Promise.all([
          createHandLandmarker(),
          createHandLandmarker(),
        ]);
        if (cancelled) {
          l1.close();
          l2.close();
          return;
        }
        landmarker1Ref.current = l1;
        landmarker2Ref.current = l2;
        setReady(true);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      landmarker1Ref.current?.close();
      landmarker2Ref.current?.close();
      stream1Ref.current?.getTracks().forEach((t) => t.stop());
      stream2Ref.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const attachCamera = useCallback(
    async (
      deviceId: string,
      videoEl: HTMLVideoElement | null,
      streamRef: React.RefObject<MediaStream | null>,
    ) => {
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
    },
    [],
  );

  useEffect(() => {
    attachCamera(cam1, video1Ref.current, stream1Ref);
  }, [cam1, attachCamera]);

  useEffect(() => {
    attachCamera(cam2, video2Ref.current, stream2Ref);
  }, [cam2, attachCamera]);

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

    const processPlayer = (
      videoEl: HTMLVideoElement | null,
      canvasEl: HTMLCanvasElement | null,
      landmarker: HandLandmarkerInstance | null,
      lastTsRef: React.RefObject<number>,
      playerRef: React.RefObject<PlayerInternal>,
      setScore: (n: number) => void,
      setStatus: (s: SeesawStatus) => void,
      accentColor: string,
    ) => {
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
      drawHands(ctx, result.landmarks, w, h, accentColor);

      const status = classifySeesaw(result.landmarks);
      setStatus(status);

      const state = playerRef.current;
      const now = performance.now();
      if (status.kind === "tilt") {
        if (
          runningRef.current &&
          state.lastHigher !== null &&
          status.higher !== state.lastHigher &&
          now > state.cooldownUntil
        ) {
          state.score += 1;
          state.cooldownUntil = now + SCORE_COOLDOWN_MS;
          setScore(state.score);
        }
        state.lastHigher = status.higher;
      }
    };

    const loop = () => {
      processPlayer(
        video1Ref.current, canvas1Ref.current, landmarker1Ref.current,
        lastTs1Ref, p1Ref, setScore1, setStatus1, "#22d3ee",
      );
      processPlayer(
        video2Ref.current, canvas2Ref.current, landmarker2Ref.current,
        lastTs2Ref, p2Ref, setScore2, setStatus2, "#f472b6",
      );
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [ready]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          runningRef.current = false;
          setRunning(false);
          setGameOver(true);
          clearInterval(interval);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  const startGame = () => {
    p1Ref.current = { score: 0, lastHigher: null, cooldownUntil: 0 };
    p2Ref.current = { score: 0, lastHigher: null, cooldownUntil: 0 };
    setScore1(0);
    setScore2(0);
    setTimeLeft(GAME_DURATION);
    setGameOver(false);
    runningRef.current = true;
    setRunning(true);
  };

  const resetGame = () => {
    runningRef.current = false;
    setRunning(false);
    setGameOver(false);
    setTimeLeft(GAME_DURATION);
    setScore1(0);
    setScore2(0);
    p1Ref.current = { score: 0, lastHigher: null, cooldownUntil: 0 };
    p2Ref.current = { score: 0, lastHigher: null, cooldownUntil: 0 };
  };

  const winnerLabel =
    score1 > score2 ? "Player 1 wins!" :
    score2 > score1 ? "Player 2 wins!" :
    "It's a tie!";

  const statusText = (s: SeesawStatus) => {
    switch (s.kind) {
      case "waiting": return "Show both hands";
      case "closed":  return "Open your palms";
      case "level":   return "Level — keep swinging";
      case "tilt":    return s.higher === "left" ? "↖ left up" : "right up ↗";
    }
  };

  const players = [
    {
      n: 1,
      score: score1,
      status: status1,
      camId: cam1,
      setCam: setCam1,
      videoRef: video1Ref,
      canvasRef: canvas1Ref,
      gradient: "from-cyan-500 to-blue-600",
      ring: "ring-cyan-400/50",
    },
    {
      n: 2,
      score: score2,
      status: status2,
      camId: cam2,
      setCam: setCam2,
      videoRef: video2Ref,
      canvasRef: canvas2Ref,
      gradient: "from-fuchsia-500 to-rose-600",
      ring: "ring-fuchsia-400/50",
    },
  ] as const;

  return (
    <>
      <Head>
        <title>six seven</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
                  six seven
                </span>
              </h1>
              <p className="text-sm text-zinc-400 mt-1">
                Two palms up, seesaw them up and down. Every swap = one point.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div
                className={`text-3xl sm:text-4xl font-mono tabular-nums px-4 py-2 rounded-lg border ${
                  timeLeft <= 10 && running
                    ? "border-red-500/60 text-red-300 animate-pulse"
                    : "border-zinc-800 text-zinc-100"
                }`}
              >
                {String(Math.floor(timeLeft / 60)).padStart(2, "0")}:
                {String(timeLeft % 60).padStart(2, "0")}
              </div>
              {!running && !gameOver && (
                <button
                  onClick={startGame}
                  disabled={!ready}
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-bold text-black"
                >
                  Start
                </button>
              )}
              {(running || gameOver) && (
                <button
                  onClick={resetGame}
                  className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-bold"
                >
                  Reset
                </button>
              )}
            </div>
          </header>

          {loadError && (
            <div className="mb-4 p-4 bg-red-950/40 border border-red-900 rounded-lg text-sm">
              Could not start hand detection: {loadError}. Make sure you granted camera access and reload.
            </div>
          )}

          {!ready && !loadError && (
            <div className="mb-4 p-4 bg-blue-950/40 border border-blue-900 rounded-lg text-sm">
              Loading hand-tracking model… (grant camera access if prompted)
            </div>
          )}

          {gameOver && (
            <div className="mb-6 p-6 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/50 rounded-xl text-center">
              <div className="text-xs uppercase tracking-[0.2em] text-amber-300">Game over</div>
              <div className="text-4xl sm:text-5xl font-bold mt-2">{winnerLabel}</div>
              <div className="mt-2 text-zinc-300 font-mono">
                {score1} – {score2}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {players.map((p) => {
              const tilt = p.status.kind === "tilt" ? p.status.higher : null;
              return (
                <div
                  key={p.n}
                  className={`rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900/60 ring-2 ${p.ring} ring-offset-2 ring-offset-zinc-950`}
                >
                  <div
                    className={`bg-gradient-to-r ${p.gradient} px-4 py-3 flex items-center justify-between`}
                  >
                    <div className="font-bold text-lg">Player {p.n}</div>
                    <div className="text-4xl font-mono font-extrabold tabular-nums drop-shadow">
                      {p.score}
                    </div>
                  </div>
                  <div className="relative aspect-video bg-black">
                    <video
                      ref={p.videoRef}
                      muted
                      playsInline
                      autoPlay
                      className="absolute inset-0 w-full h-full object-cover -scale-x-100"
                    />
                    <canvas
                      ref={p.canvasRef}
                      className="absolute inset-0 w-full h-full -scale-x-100"
                    />
                    <div className="absolute top-2 left-2 text-xs px-2 py-1 bg-black/70 rounded font-mono">
                      {statusText(p.status)}
                    </div>
                    {tilt && (
                      <div
                        className={`absolute inset-x-0 bottom-3 flex justify-around items-end pointer-events-none`}
                      >
                        <div
                          className={`text-5xl sm:text-6xl transition-transform ${
                            tilt === "left" ? "-translate-y-3" : "translate-y-3 opacity-60"
                          }`}
                        >
                          ✋
                        </div>
                        <div
                          className={`text-5xl sm:text-6xl transition-transform ${
                            tilt === "right" ? "-translate-y-3" : "translate-y-3 opacity-60"
                          }`}
                        >
                          ✋
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1">
                      Camera
                    </label>
                    <select
                      value={p.camId}
                      onChange={(e) => p.setCam(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-zinc-500"
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
              );
            })}
          </div>

          <div className="mt-6 p-4 bg-zinc-900/40 border border-zinc-800 rounded-lg text-sm text-zinc-400">
            <div className="font-semibold text-zinc-200 mb-2">How to score</div>
            <ul className="space-y-1 list-disc list-inside">
              <li>Hold both hands up in front of your camera, palms facing the lens.</li>
              <li>Do the <span className="text-zinc-100 font-semibold">six seven</span> motion: alternate one hand up while the other goes down, like a seesaw.</li>
              <li>Every time the higher hand swaps, you get a point. Whoever has the most when the timer hits 0 wins.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
