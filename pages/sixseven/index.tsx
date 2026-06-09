import { MonadWalletButton } from "@/components/MonadWalletButton";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { useAccount } from "wagmi";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(len = 6) {
  let s = "";
  const buf = new Uint8Array(len);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < len; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length];
  return s;
}

export default function SixSevenLobby() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const [mode, setMode] = useState<"menu" | "join">("menu");
  const [joinCode, setJoinCode] = useState("");

  const create = () => {
    if (!isConnected) return;
    router.push(`/sixseven/${generateCode()}`);
  };

  const join = () => {
    if (!isConnected) return;
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return;
    router.push(`/sixseven/${code}`);
  };

  return (
    <>
      <Head>
        <title>What&apos;s 67? — Lobby</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className="lobby">
        <div className="glow" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />

        <header className="bar">
          <Link href="/" className="exit">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M15 18l-6-6 6-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Exit
          </Link>
          <MonadWalletButton />
        </header>

        <section className="panel">
          <span className="eyebrow">Multiplayer Party</span>
          <h1>What&apos;s 67?</h1>
          <p className="lede">
            Create a room and share the code, or join your opponent. Two players, a
            20-second 6-7 seesaw showdown — most swaps wins.
          </p>

          {!isConnected && (
            <div className="notice">
              <span className="dot" aria-hidden="true" />
              Connect your wallet to create or join a room.
            </div>
          )}

          {mode === "menu" ? (
            <div className="menu">
              <button
                type="button"
                className="action primary"
                onClick={create}
                disabled={!isConnected}
              >
                <span className="label">Create room</span>
                <span className="hint">Generate a code and host</span>
              </button>

              <button
                type="button"
                className="action"
                onClick={() => setMode("join")}
                disabled={!isConnected}
              >
                <span className="label">Join room</span>
                <span className="hint">Enter a friend&apos;s code</span>
              </button>

              <Link href="/" className="action ghost">
                <span className="label">Exit</span>
                <span className="hint">Back to library</span>
              </Link>
            </div>
          ) : (
            <div className="joinBox">
              <label htmlFor="code">Room code</label>
              <div className="joinRow">
                <input
                  id="code"
                  value={joinCode}
                  onChange={(e) =>
                    setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") join();
                  }}
                  maxLength={8}
                  placeholder="ABC123"
                  autoFocus
                  inputMode="text"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="action primary compact"
                  onClick={join}
                  disabled={!isConnected || joinCode.trim().length < 4}
                >
                  Join
                </button>
              </div>
              <button type="button" className="back" onClick={() => setMode("menu")}>
                ← Back
              </button>
            </div>
          )}
        </section>
      </main>

      <style jsx>{`
        .lobby {
          position: relative;
          min-height: 100vh;
          min-height: 100dvh;
          overflow: hidden;
          display: grid;
          grid-template-rows: auto 1fr;
          padding: clamp(18px, 2.6vw, 34px) clamp(22px, 5vw, 64px) clamp(28px, 4vw, 48px);
          font-family: var(--font-sans);
          color: var(--text);
        }

        .glow {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(56% 52% at 50% 0%, rgba(192, 132, 252, 0.32) 0%, transparent 62%),
            radial-gradient(48% 48% at 88% 90%, rgba(34, 211, 238, 0.16) 0%, transparent 60%);
        }

        .grain {
          position: absolute;
          inset: 0;
          opacity: 0.05;
          mix-blend-mode: soft-light;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }

        .bar,
        .panel {
          position: relative;
          z-index: 1;
        }

        .bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        :global(.exit) {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 14px;
          border-radius: var(--r-pill);
          background: var(--surface);
          box-shadow: inset 0 0 0 1px var(--border);
          color: var(--text-dim);
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          backdrop-filter: blur(10px);
          transition: color 160ms ease, background 160ms ease;
        }

        :global(.exit:hover) {
          color: var(--text);
          background: var(--surface-strong);
        }

        .panel {
          align-self: center;
          justify-self: center;
          width: 100%;
          max-width: 480px;
          animation: rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .eyebrow {
          display: inline-flex;
          padding: 6px 12px;
          border-radius: var(--r-pill);
          background: var(--surface);
          box-shadow: inset 0 0 0 1px var(--border);
          color: color-mix(in srgb, #c084fc, #ffffff 24%);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        h1 {
          margin: 16px 0 0;
          font-size: clamp(40px, 7vw, 64px);
          line-height: 1;
          letter-spacing: -0.03em;
          font-weight: 700;
        }

        .lede {
          margin: 16px 0 0;
          color: var(--text-dim);
          font-size: 15px;
          line-height: 1.55;
        }

        .notice {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-top: 22px;
          padding: 12px 14px;
          border-radius: var(--r-md);
          background: rgba(252, 211, 77, 0.1);
          box-shadow: inset 0 0 0 1px rgba(252, 211, 77, 0.28);
          color: #fcd34d;
          font-size: 13px;
          font-weight: 500;
        }

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #fcd34d;
          box-shadow: 0 0 10px #fcd34d;
          flex: 0 0 auto;
        }

        .menu {
          display: grid;
          gap: 12px;
          margin-top: 26px;
        }

        :global(.action) {
          display: grid;
          gap: 3px;
          width: 100%;
          padding: 16px 20px;
          border: 0;
          border-radius: var(--r-md);
          text-align: left;
          text-decoration: none;
          cursor: pointer;
          background: var(--surface-strong);
          box-shadow: inset 0 0 0 1px var(--border);
          color: var(--text);
          transition: transform 160ms ease, background 160ms ease, box-shadow 160ms ease;
        }

        :global(.action:hover:not(:disabled)) {
          transform: translateY(-2px);
          background: rgba(255, 255, 255, 0.12);
        }

        :global(.action.primary) {
          background: linear-gradient(135deg, #c084fc, #7c3aed);
          box-shadow: 0 14px 30px rgba(124, 58, 237, 0.34);
          color: #fff;
        }

        :global(.action.primary:hover:not(:disabled)) {
          transform: translateY(-2px);
          box-shadow: 0 18px 40px rgba(124, 58, 237, 0.46);
          background: linear-gradient(135deg, #c899ff, #864ff0);
        }

        :global(.action.ghost) {
          background: transparent;
          box-shadow: inset 0 0 0 1px var(--border);
          color: var(--text-dim);
        }

        :global(.action:disabled) {
          opacity: 0.45;
          cursor: not-allowed;
        }

        :global(.action .label) {
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        :global(.action .hint) {
          font-size: 13px;
          opacity: 0.7;
        }

        .joinBox {
          margin-top: 26px;
        }

        .joinBox label {
          display: block;
          margin-bottom: 8px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--text-mute);
        }

        .joinRow {
          display: flex;
          gap: 10px;
        }

        .joinRow input {
          flex: 1;
          min-width: 0;
          height: 56px;
          padding: 0 18px;
          border: 0;
          border-radius: var(--r-md);
          background: rgba(0, 0, 0, 0.3);
          box-shadow: inset 0 0 0 1px var(--border);
          color: var(--text);
          font-family: var(--font-mono);
          font-size: 22px;
          letter-spacing: 0.32em;
          text-align: center;
          text-transform: uppercase;
        }

        .joinRow input::placeholder {
          color: var(--text-mute);
          letter-spacing: 0.32em;
        }

        .joinRow input:focus {
          outline: none;
          box-shadow: inset 0 0 0 1px color-mix(in srgb, #c084fc, transparent 40%);
        }

        :global(.action.compact) {
          width: auto;
          display: inline-flex;
          align-items: center;
          padding: 0 26px;
          height: 56px;
          font-size: 15px;
          font-weight: 600;
        }

        .back {
          margin-top: 14px;
          border: 0;
          background: transparent;
          color: var(--text-mute);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          padding: 4px 0;
        }

        .back:hover {
          color: var(--text);
        }

        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  );
}
