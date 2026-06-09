import { PageHeader } from "@/components/PageHeader";
import { PortalShell } from "@/components/PortalShell";
import { games, powerActions } from "@/components/portalData";
import Head from "next/head";
import type { ReactNode } from "react";

const icons: Record<string, ReactNode> = {
  sleep: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  restart: (
    <>
      <path d="M20 11.5a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4h-4" />
    </>
  ),
  disconnect: (
    <>
      <circle cx="12" cy="8.5" r="3.2" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </>
  ),
};

export default function PowerPage() {
  const backgroundGame = games[4];

  return (
    <>
      <Head>
        <title>Power | Monad Arcade</title>
      </Head>

      <PortalShell active="power" accent={backgroundGame.accent} cover={backgroundGame.cover}>
        <PageHeader
          eyebrow="Power"
          title="Session controls"
          subtitle="Pause the portal or manage your wallet — your session stays in sync."
        />

        <section className="powerGrid" aria-label="Power actions">
          {powerActions.map((action) => (
            <button key={action.id} className="powerCard" type="button">
              <span className="icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {icons[action.id]}
                </svg>
              </span>
              <strong>{action.title}</strong>
              <span className="desc">{action.description}</span>
            </button>
          ))}
        </section>
      </PortalShell>

      <style jsx>{`
        .powerGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }

        .powerCard {
          min-height: 196px;
          border: 0;
          border-radius: var(--r-lg);
          display: grid;
          align-content: center;
          justify-items: center;
          gap: 14px;
          padding: 28px;
          color: #fff;
          background: rgba(13, 14, 18, 0.62);
          box-shadow: inset 0 0 0 1px var(--border), var(--shadow-md);
          backdrop-filter: blur(14px);
          text-align: center;
          cursor: pointer;
          transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 200ms ease;
        }

        .powerCard:hover {
          transform: translateY(-6px);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand), transparent 50%),
            0 26px 54px rgba(131, 110, 249, 0.26);
        }

        .icon {
          display: grid;
          place-items: center;
          width: 56px;
          height: 56px;
          border-radius: 18px;
          color: var(--brand-bright);
          background: var(--surface-strong);
          box-shadow: inset 0 0 0 1px var(--border);
        }

        .powerCard strong {
          font-size: clamp(20px, 2vw, 26px);
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        .desc {
          max-width: 26ch;
          color: var(--text-dim);
          font-size: 14px;
          line-height: 1.5;
        }

        @media (max-width: 780px) {
          .powerGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}
