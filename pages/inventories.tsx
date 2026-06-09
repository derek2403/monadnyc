import { PageHeader } from "@/components/PageHeader";
import { PortalShell } from "@/components/PortalShell";
import { games } from "@/components/portalData";
import Head from "next/head";
import type { CSSProperties } from "react";

type InventoryItemStyle = CSSProperties & {
  "--item-accent": string;
};

export default function InventoriesPage() {
  const backgroundGame = games[2];
  const inventoryRows = games.flatMap((game) =>
    game.inventory.map((item) => ({
      item,
      game: game.name,
      accent: game.accent,
    })),
  );

  return (
    <>
      <Head>
        <title>Inventory | Monad Arcade</title>
      </Head>

      <PortalShell active="inventories" accent={backgroundGame.accent} cover={backgroundGame.cover}>
        <PageHeader
          eyebrow="Inventory"
          title="Collected items"
          subtitle={`${inventoryRows.length} on-chain assets across your library, ready to trade or equip.`}
        />

        <section className="inventoryGrid" aria-label="Inventory items">
          {inventoryRows.map((row) => (
            <article
              key={`${row.game}-${row.item}`}
              className="inventoryItem"
              style={{ "--item-accent": row.accent } as InventoryItemStyle}
            >
              <div className="itemIcon" aria-hidden="true" />
              <div className="itemBody">
                <strong>{row.item}</strong>
                <span>{row.game}</span>
              </div>
              <span className="chip" aria-hidden="true">
                NFT
              </span>
            </article>
          ))}
        </section>
      </PortalShell>

      <style jsx>{`
        .inventoryGrid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(min(100%, 232px), 1fr));
          gap: 14px;
        }

        .inventoryItem {
          position: relative;
          min-height: 92px;
          border-radius: var(--r-md);
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 16px;
          background: rgba(13, 14, 18, 0.6);
          box-shadow: inset 0 0 0 1px var(--border), var(--shadow-sm);
          backdrop-filter: blur(14px);
          transition: transform 180ms ease, box-shadow 180ms ease;
        }

        .inventoryItem:hover {
          transform: translateY(-3px);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--item-accent), transparent 55%),
            0 18px 36px rgba(0, 0, 0, 0.36);
        }

        .itemIcon {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          flex: 0 0 auto;
          background:
            radial-gradient(circle at 30% 26%, rgba(255, 255, 255, 0.85) 0 8%, transparent 9%),
            linear-gradient(140deg, var(--item-accent), color-mix(in srgb, var(--item-accent), #0a0b10 60%));
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18),
            0 8px 18px color-mix(in srgb, var(--item-accent), transparent 65%);
        }

        .itemBody {
          display: grid;
          gap: 3px;
          min-width: 0;
        }

        .itemBody strong,
        .itemBody span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .itemBody strong {
          font-size: 17px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        .itemBody span {
          color: var(--text-mute);
          font-size: 13px;
        }

        .chip {
          margin-left: auto;
          padding: 4px 9px;
          border-radius: var(--r-pill);
          background: var(--surface);
          box-shadow: inset 0 0 0 1px var(--border);
          color: var(--text-dim);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          font-family: var(--font-mono);
        }
      `}</style>
    </>
  );
}
