import { PortalShell } from "@/components/PortalShell";
import { games } from "@/components/portalData";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import Head from "next/head";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import { useState } from "react";
import { useAccount } from "wagmi";

type CardStyle = CSSProperties & {
  "--thumb": string;
  "--accent": string;
};

export default function LibraryPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedGame = games[selectedIndex];

  const playable = Boolean(selectedGame.route);
  const playLabel = !playable
    ? "Coming soon"
    : isConnected
      ? "Play now"
      : "Connect to play";

  const handlePlay = () => {
    if (!playable || !selectedGame.route) return;
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    router.push(selectedGame.route);
  };

  return (
    <>
      <Head>
        <title>Library | Monad Arcade</title>
      </Head>

      <PortalShell active="library" accent={selectedGame.accent} cover={selectedGame.cover}>
        <section
          className="libraryHero"
          aria-label="Selected game"
          style={{ "--accent": selectedGame.accent } as CSSProperties}
        >
          <span className="eyebrow">{selectedGame.category}</span>
          <h1>{selectedGame.name}</h1>
          <p className="tagline">{selectedGame.tagline}</p>

          <div className="meta">
            <span className="players">
              <span className="dot" aria-hidden="true" />
              <strong>{selectedGame.players}</strong> playing now
            </span>
            <span className="divider" aria-hidden="true" />
            <span className="studio">{selectedGame.studio}</span>
          </div>

          <div className="actions">
            <button
              type="button"
              className="play"
              onClick={handlePlay}
              disabled={!playable}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M8 5.5 18 12 8 18.5V5.5Z" fill="currentColor" />
              </svg>
              {playLabel}
            </button>
            <button type="button" className="ghost">
              Add to library
            </button>
          </div>
        </section>

        <section className="gameShelf" aria-label="Game library">
          <header className="shelfHead">
            <h2>Your games</h2>
            <span>{games.length} titles</span>
          </header>
          <div className="gameRail" role="listbox" aria-label="Choose a game">
            {games.map((game, index) => (
              <button
                key={game.id}
                className={`gameCard ${selectedIndex === index ? "isSelected" : ""}`}
                onClick={() => setSelectedIndex(index)}
                type="button"
                role="option"
                aria-selected={selectedIndex === index}
                style={{ "--thumb": game.thumbnail, "--accent": game.accent } as CardStyle}
              >
                <span className="thumbArt">
                  <span className="thumbTitle">{game.name}</span>
                  <span className="playBadge" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path d="M8 5.5 18 12 8 18.5V5.5Z" fill="currentColor" />
                    </svg>
                  </span>
                </span>
                <span className="gameMeta">
                  <strong>{game.name}</strong>
                  <span>{game.category}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </PortalShell>

      <style jsx>{`
        .libraryHero {
          min-width: 0;
          padding-bottom: 30px;
        }

        .eyebrow {
          display: inline-flex;
          align-items: center;
          padding: 6px 12px;
          border-radius: var(--r-pill);
          background: var(--surface);
          box-shadow: inset 0 0 0 1px var(--border);
          color: color-mix(in srgb, var(--accent), #ffffff 26%);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          backdrop-filter: blur(8px);
        }

        h1 {
          max-width: 14ch;
          margin: 18px 0 0;
          font-size: clamp(46px, 8vw, 104px);
          line-height: 0.94;
          letter-spacing: -0.04em;
          font-weight: 700;
          text-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
        }

        .tagline {
          max-width: 50ch;
          margin: 20px 0 0;
          color: var(--text-dim);
          font-size: clamp(16px, 1.8vw, 21px);
          line-height: 1.45;
        }

        .meta {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-top: 22px;
          color: var(--text-dim);
          font-size: 14px;
        }

        .players {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-mono);
        }

        .players strong {
          color: var(--text);
          font-weight: 600;
        }

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #34d399;
          box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.6);
          animation: pulse 2.4s ease-out infinite;
        }

        .divider {
          width: 1px;
          height: 14px;
          background: var(--border-strong);
        }

        .studio {
          font-weight: 500;
        }

        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 28px;
        }

        .play,
        .ghost {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          height: 52px;
          padding: 0 26px;
          border: 0;
          border-radius: var(--r-pill);
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
        }

        .play {
          color: #0a0a0c;
          background: #ffffff;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
        }

        .play:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 16px 38px color-mix(in srgb, var(--accent), transparent 55%);
        }

        .play:disabled {
          cursor: not-allowed;
          color: var(--text-dim);
          background: var(--surface-strong);
          box-shadow: inset 0 0 0 1px var(--border);
        }

        .ghost {
          color: var(--text);
          background: var(--surface-strong);
          box-shadow: inset 0 0 0 1px var(--border);
          backdrop-filter: blur(10px);
        }

        .ghost:hover {
          transform: translateY(-2px);
          background: rgba(255, 255, 255, 0.12);
        }

        .gameShelf {
          min-width: 0;
          margin-top: auto;
        }

        .shelfHead {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          margin-bottom: 14px;
        }

        .shelfHead h2 {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: var(--text);
        }

        .shelfHead span {
          font-size: 13px;
          color: var(--text-mute);
          font-family: var(--font-mono);
        }

        .gameRail {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: clamp(170px, 18vw, 230px);
          gap: clamp(14px, 1.6vw, 22px);
          overflow-x: auto;
          overflow-y: visible;
          padding: 10px 4px 20px;
          scroll-snap-type: x proximity;
          scrollbar-width: none;
        }

        .gameRail::-webkit-scrollbar {
          display: none;
        }

        .gameCard {
          border: 0;
          background: transparent;
          color: inherit;
          cursor: pointer;
          min-width: 0;
          padding: 0;
          text-align: left;
          scroll-snap-align: start;
          transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .gameCard:hover,
        .gameCard.isSelected {
          transform: translateY(-8px);
        }

        .thumbArt {
          position: relative;
          display: flex;
          align-items: flex-end;
          min-width: 0;
          aspect-ratio: 4 / 5;
          overflow: hidden;
          border-radius: var(--r-md);
          background: var(--thumb);
          box-shadow: inset 0 0 0 1px var(--border), var(--shadow-md);
        }

        .thumbArt::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, transparent 40%, rgba(5, 6, 9, 0.82) 100%);
        }

        .thumbTitle {
          position: relative;
          z-index: 1;
          display: block;
          width: 100%;
          padding: 16px;
          color: #fff;
          font-size: clamp(17px, 1.9vw, 22px);
          line-height: 1;
          font-weight: 700;
          letter-spacing: -0.02em;
          text-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
          overflow-wrap: anywhere;
        }

        .playBadge {
          position: absolute;
          z-index: 1;
          top: 14px;
          right: 14px;
          display: grid;
          place-items: center;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          color: #0a0a0c;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: var(--shadow-sm);
          opacity: 0;
          transform: scale(0.8);
          transition: opacity 200ms ease, transform 200ms ease;
        }

        .gameCard:hover .playBadge {
          opacity: 1;
          transform: scale(1);
        }

        .gameCard.isSelected .thumbArt {
          box-shadow: inset 0 0 0 2px var(--accent),
            0 22px 44px color-mix(in srgb, var(--accent), transparent 60%);
        }

        .gameMeta {
          display: grid;
          gap: 3px;
          margin-top: 14px;
          min-width: 0;
        }

        .gameMeta strong,
        .gameMeta span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .gameMeta strong {
          color: #fff;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        .gameMeta span {
          color: var(--text-mute);
          font-size: 13px;
          font-weight: 500;
        }

        .gameCard.isSelected .gameMeta strong {
          color: color-mix(in srgb, var(--accent), #ffffff 22%);
        }

        @keyframes pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.55);
          }
          70% {
            box-shadow: 0 0 0 8px rgba(52, 211, 153, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(52, 211, 153, 0);
          }
        }

        @media (max-width: 680px) {
          .gameRail {
            grid-auto-columns: min(54vw, 200px);
          }
        }
      `}</style>
    </>
  );
}
