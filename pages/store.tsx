import { PageHeader } from "@/components/PageHeader";
import { PortalShell } from "@/components/PortalShell";
import { games, storeItems } from "@/components/portalData";
import Head from "next/head";
import type { CSSProperties } from "react";

type StoreCardStyle = CSSProperties & {
  "--item-accent": string;
};

export default function StorePage() {
  const featureGame = games[1];

  return (
    <>
      <Head>
        <title>Store | Monad Arcade</title>
      </Head>

      <PortalShell active="store" accent={featureGame.accent} cover={featureGame.cover}>
        <PageHeader
          eyebrow="Store"
          title="Arcade drops"
          subtitle="Season passes, cosmetics and tournament tickets — settled instantly in MON."
        />

        <section className="storeGrid" aria-label="Store items">
          {storeItems.map((item) => (
            <button
              key={item.id}
              className="storeCard"
              type="button"
              style={{ "--item-accent": item.accent } as StoreCardStyle}
            >
              <span className="art" aria-hidden="true" />
              <span className="tag">{item.tag}</span>
              <strong>{item.title}</strong>
              <span className="desc">{item.description}</span>
              <span className="buy">
                <em>{item.price}</em>
                <span className="cta">Buy</span>
              </span>
            </button>
          ))}
        </section>
      </PortalShell>

      <style jsx>{`
        .storeGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 18px;
        }

        .storeCard {
          position: relative;
          min-height: 248px;
          border: 0;
          border-radius: var(--r-lg);
          display: grid;
          align-content: end;
          gap: 8px;
          padding: 20px;
          color: #fff;
          text-align: left;
          cursor: pointer;
          overflow: hidden;
          background: rgba(13, 14, 18, 0.66);
          box-shadow: inset 0 0 0 1px var(--border), var(--shadow-md);
          backdrop-filter: blur(14px);
          transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 200ms ease;
        }

        .art {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(
              90% 70% at 76% 12%,
              color-mix(in srgb, var(--item-accent), transparent 30%) 0%,
              transparent 58%
            ),
            linear-gradient(160deg, color-mix(in srgb, var(--item-accent), #0a0b10 72%), transparent 70%);
          opacity: 0.9;
        }

        .storeCard:hover {
          transform: translateY(-6px);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--item-accent), transparent 50%),
            0 26px 54px color-mix(in srgb, var(--item-accent), transparent 64%);
        }

        .storeCard > :not(.art) {
          position: relative;
          z-index: 1;
        }

        .tag {
          justify-self: start;
          padding: 4px 10px;
          margin-bottom: 4px;
          border-radius: var(--r-pill);
          background: rgba(0, 0, 0, 0.35);
          box-shadow: inset 0 0 0 1px var(--border);
          color: color-mix(in srgb, var(--item-accent), #ffffff 30%);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .storeCard strong {
          font-size: clamp(20px, 2vw, 26px);
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.05;
        }

        .desc {
          color: var(--text-dim);
          font-size: 13px;
          line-height: 1.45;
        }

        .buy {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 12px;
        }

        .buy em {
          font-style: normal;
          font-family: var(--font-mono);
          font-size: 15px;
          font-weight: 600;
          color: #fff;
        }

        .cta {
          padding: 7px 16px;
          border-radius: var(--r-pill);
          background: #fff;
          color: #0a0a0c;
          font-size: 13px;
          font-weight: 600;
          transition: transform 160ms ease;
        }

        .storeCard:hover .cta {
          transform: translateX(2px);
        }

        @media (max-width: 920px) {
          .storeGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 560px) {
          .storeGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}
