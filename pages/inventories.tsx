import { PageHeader } from "@/components/PageHeader";
import { PortalShell } from "@/components/PortalShell";
import { games } from "@/components/portalData";
import { COLLAR_ABI, COLLAR_ADDRESS, NFT_ABI, NFT_ADDRESS } from "@/lib/contracts";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import Head from "next/head";
import type { CSSProperties } from "react";
import { useMemo } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

type InventoryItemStyle = CSSProperties & {
  "--item-accent": string;
};

const EXPLORER = "https://testnet.monadexplorer.com";

type Collection = {
  key: string;
  label: string;
  symbol: string;
  address: `0x${string}`;
  abi: typeof NFT_ABI;
  accent: string;
};

// Every trophy the arcade can mint, one entry per game.
const COLLECTIONS: Collection[] = [
  {
    key: "sixseven",
    label: "What's 67?",
    symbol: "SIX67",
    address: NFT_ADDRESS,
    abi: NFT_ABI,
    accent: "#c084fc",
  },
  {
    key: "bark",
    label: "Bark Battle",
    symbol: "COLLAR",
    address: COLLAR_ADDRESS,
    abi: COLLAR_ABI as unknown as typeof NFT_ABI,
    accent: "#fbbf24",
  },
];

type TrophyMeta = { name: string; image: string };

/** The trophy's tokenURI is a base64 data-URI JSON shared by every token. */
function decodeTokenURI(uri?: string): TrophyMeta | null {
  if (!uri || !uri.startsWith("data:")) return null;
  try {
    const parsed = JSON.parse(atob(uri.split(",")[1] ?? ""));
    return { name: parsed.name ?? "Trophy", image: parsed.image ?? "" };
  } catch {
    return null;
  }
}

/** Read which tokens of one collection the connected wallet owns. */
function useOwnedTrophies(address: `0x${string}` | undefined, c: Collection, enabled: boolean) {
  // Tokens are minted 1..nextId-1 (nextId starts at 1, no burns).
  const { data: nextId } = useReadContract({
    address: c.address,
    abi: c.abi,
    functionName: "nextId",
    query: { enabled, refetchInterval: 8000 },
  });
  const minted = nextId ? Number(nextId) - 1 : 0;

  // No ERC721Enumerable, so walk every id and keep the ones this wallet owns.
  const ownerCalls = useMemo(
    () =>
      Array.from({ length: minted }, (_, i) => ({
        address: c.address,
        abi: c.abi,
        functionName: "ownerOf" as const,
        args: [BigInt(i + 1)],
      })),
    [minted, c.address, c.abi],
  );

  const { data: owners, isLoading } = useReadContracts({
    contracts: ownerCalls,
    allowFailure: true,
    query: { enabled: enabled && minted > 0 },
  });

  const ids = useMemo(() => {
    if (!owners || !address) return [];
    const me = address.toLowerCase();
    const out: number[] = [];
    owners.forEach((res, i) => {
      if (res.status === "success" && String(res.result).toLowerCase() === me) {
        out.push(i + 1);
      }
    });
    return out;
  }, [owners, address]);

  // Shared metadata — read it once from the lowest minted token.
  const { data: uri } = useReadContract({
    address: c.address,
    abi: c.abi,
    functionName: "tokenURI",
    args: [1n],
    query: { enabled: enabled && minted > 0 },
  });
  const meta = useMemo(() => decodeTokenURI(uri as string | undefined), [uri]);

  return { ids, meta, scanning: enabled && minted > 0 && isLoading };
}

export default function InventoriesPage() {
  const bg = games[2];
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const sixseven = useOwnedTrophies(address, COLLECTIONS[0], isConnected);
  const bark = useOwnedTrophies(address, COLLECTIONS[1], isConnected);
  const reads = [sixseven, bark];

  const items = useMemo(
    () =>
      COLLECTIONS.flatMap((c, i) =>
        reads[i].ids.map((id) => ({ id, c, meta: reads[i].meta })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sixseven.ids, sixseven.meta, bark.ids, bark.meta],
  );

  const scanning = isConnected && reads.some((r) => r.scanning) && items.length === 0;
  const count = items.length;

  const subtitle = !isConnected
    ? "Connect your wallet to see the trophies you've won on-chain."
    : scanning
      ? "Reading your trophies from the chain…"
      : count === 0
        ? "No trophies yet — win a What's 67? or Bark Battle match to mint one."
        : `${count} on-chain trophy NFT${count === 1 ? "" : "s"} held by ${address?.slice(0, 6)}…${address?.slice(-4)}.`;

  return (
    <>
      <Head>
        <title>Inventory | Monad Arcade</title>
      </Head>

      <PortalShell active="inventories" accent={bg.accent} cover={bg.cover}>
        <PageHeader eyebrow="Inventory" title="Collected items" subtitle={subtitle} />

        {!isConnected ? (
          <div className="state">
            <p>Your inventory lives in your wallet.</p>
            <button type="button" onClick={() => openConnectModal?.()}>
              Connect wallet
            </button>
          </div>
        ) : scanning ? (
          <div className="state">
            <p>Scanning the chain for your trophies…</p>
          </div>
        ) : count === 0 ? (
          <div className="state">
            <p>No NFTs in this wallet yet.</p>
            <span className="muted">
              Trophies are minted to the winner when a staked match resolves.
            </span>
          </div>
        ) : (
          <section className="inventoryGrid" aria-label="Inventory items">
            {items.map(({ id, c, meta }) => (
              <a
                key={`${c.key}-${id}`}
                className="inventoryItem"
                href={`${EXPLORER}/token/${c.address}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ "--item-accent": c.accent } as InventoryItemStyle}
              >
                {meta?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="itemArt" src={meta.image} alt={meta.name} />
                ) : (
                  <div className="itemIcon" aria-hidden="true" />
                )}
                <div className="itemBody">
                  <strong>{meta?.name ?? "Trophy"}</strong>
                  <span>
                    {c.label} · #{id}
                  </span>
                </div>
                <span className="chip">{c.symbol}</span>
              </a>
            ))}
          </section>
        )}
      </PortalShell>

      <style jsx>{`
        .state {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 14px;
          padding: 40px 0;
          color: var(--text-dim);
        }

        .state p {
          margin: 0;
          font-size: 16px;
        }

        .state .muted {
          color: var(--text-mute);
          font-size: 14px;
        }

        .state button {
          height: 46px;
          padding: 0 22px;
          border: 0;
          border-radius: var(--r-pill);
          background: linear-gradient(135deg, var(--brand-bright), #6b54e6);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 12px 28px rgba(131, 110, 249, 0.34);
        }

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
          text-decoration: none;
          color: inherit;
          transition: transform 180ms ease, box-shadow 180ms ease;
        }

        .inventoryItem:hover {
          transform: translateY(-3px);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--item-accent), transparent 55%),
            0 18px 36px rgba(0, 0, 0, 0.36);
        }

        .itemArt {
          width: 52px;
          height: 52px;
          flex: 0 0 auto;
          object-fit: cover;
          border-radius: 14px;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18),
            0 8px 18px color-mix(in srgb, var(--item-accent), transparent 65%);
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
