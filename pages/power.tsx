import { PageHeader } from "@/components/PageHeader";
import { PortalShell } from "@/components/PortalShell";
import { games } from "@/components/portalData";
import { LAUNCHPAD_ABI, LAUNCHPAD_ADDRESS } from "@/lib/contracts";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

const GENRES = ["Party", "Racing", "RPG", "Puzzle", "Arena", "Adventure", "Other"];
const EXPLORER = "https://testnet.monadexplorer.com";

type LaunchedGame = {
  token: `0x${string}`;
  creator: `0x${string}`;
  name: string;
  symbol: string;
  description: string;
  genre: string;
  coverImage: string;
  thumbnail: string;
  gameUrl: string;
  supply: bigint;
  createdAt: bigint;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: bigint) => Number(formatEther(n)).toLocaleString("en-US");

export default function HostPage() {
  const bg = games[0];
  const { isConnected } = useAccount();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [genre, setGenre] = useState(GENRES[0]);
  const [supply, setSupply] = useState("1000000");
  const [description, setDescription] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [thumbnail, setThumbnail] = useState("");
  const [gameUrl, setGameUrl] = useState("");
  const [launched, setLaunched] = useState<string | null>(null);

  const { writeContractAsync, isPending } = useWriteContract();
  const [pendingTx, setPendingTx] = useState<`0x${string}` | undefined>(undefined);
  const { isLoading: mining, isSuccess: mined } = useWaitForTransactionReceipt({
    hash: pendingTx,
    query: { enabled: Boolean(pendingTx) },
  });

  const { data: rawGames, refetch } = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: LAUNCHPAD_ABI,
    functionName: "getGames",
    args: [0n, 100n],
    query: { refetchInterval: 5000 },
  });

  const list = useMemo(() => {
    const arr = (rawGames as readonly LaunchedGame[] | undefined) ?? [];
    return [...arr].reverse(); // newest first
  }, [rawGames]);

  const supplyNum = Number(supply);
  const valid =
    isConnected &&
    name.trim().length > 0 &&
    symbol.trim().length > 0 &&
    Number.isFinite(supplyNum) &&
    supplyNum > 0;
  const busy = isPending || mining;

  useEffect(() => {
    if (mined) {
      refetch();
      setPendingTx(undefined);
    }
  }, [mined, refetch]);

  const launch = async () => {
    if (!valid) return;
    let supplyWei: bigint;
    try {
      supplyWei = parseEther(supply);
    } catch {
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: LAUNCHPAD_ADDRESS,
        abi: LAUNCHPAD_ABI,
        functionName: "launchGame",
        args: [
          name.trim(),
          symbol.trim(),
          description.trim(),
          genre,
          coverImage.trim(),
          thumbnail.trim(),
          gameUrl.trim(),
          supplyWei,
        ],
      });
      setPendingTx(hash);
      setLaunched(symbol.trim());
      setName("");
      setSymbol("");
      setDescription("");
      setCoverImage("");
      setThumbnail("");
      setGameUrl("");
      setSupply("1000000");
    } catch {
      /* rejected or reverted */
    }
  };

  return (
    <>
      <Head>
        <title>Host your game | Monad Arcade</title>
      </Head>

      <PortalShell active="power" accent={bg.accent} cover={bg.cover}>
        <PageHeader
          eyebrow="Launchpad"
          title="Host your game"
          subtitle="List your game on Monad and mint its token in one transaction. The full supply lands in your wallet."
        />

        <section className="grid" aria-label="Game launchpad">
          {/* Launch form */}
          <form
            className="panel form"
            onSubmit={(e) => {
              e.preventDefault();
              launch();
            }}
          >
            <h2>Launch a new game</h2>

            <label>
              Game name
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 40))}
                placeholder="Skyward Realms"
                maxLength={40}
              />
            </label>

            <div className="row">
              <label className="grow">
                Token symbol
                <input
                  value={symbol}
                  onChange={(e) =>
                    setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))
                  }
                  placeholder="SKY"
                  className="mono"
                />
              </label>
              <label>
                Genre
                <select value={genre} onChange={(e) => setGenre(e.target.value)}>
                  {GENRES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              Total supply
              <div className="supply">
                <input
                  value={supply}
                  onChange={(e) => setSupply(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  className="mono"
                />
                <span>{symbol || "tokens"}</span>
              </div>
            </label>

            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 160))}
                placeholder="A one-line pitch for your game."
                rows={2}
                maxLength={160}
              />
            </label>

            <label>
              Cover image URL
              <input
                value={coverImage}
                onChange={(e) => setCoverImage(e.target.value.slice(0, 300))}
                placeholder="https://…/cover.jpg"
                type="url"
                inputMode="url"
              />
            </label>

            <label>
              Thumbnail URL
              <input
                value={thumbnail}
                onChange={(e) => setThumbnail(e.target.value.slice(0, 300))}
                placeholder="https://…/thumb.jpg"
                type="url"
                inputMode="url"
              />
            </label>

            <label>
              Game URL
              <input
                value={gameUrl}
                onChange={(e) => setGameUrl(e.target.value.slice(0, 300))}
                placeholder="https://yourgame.xyz"
                type="url"
                inputMode="url"
              />
            </label>

            {(coverImage.trim() || thumbnail.trim()) && (
              <div className="previewRow">
                {coverImage.trim() && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="coverPreview" src={coverImage.trim()} alt="Cover preview" />
                )}
                {thumbnail.trim() && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="thumbPreview" src={thumbnail.trim()} alt="Thumbnail preview" />
                )}
              </div>
            )}

            {!isConnected && (
              <p className="hint">Connect your wallet to launch a game.</p>
            )}

            {launched && mined && (
              <p className="success">
                🚀 <strong>{launched}</strong> launched — token minted to your wallet.
              </p>
            )}

            <button type="submit" className="launch" disabled={!valid || busy}>
              {busy ? "Launching…" : "Launch & mint token"}
            </button>
          </form>

          {/* Registry */}
          <div className="panel list">
            <div className="listHead">
              <h2>Launched games</h2>
              <span>{list.length}</span>
            </div>

            <div className="rows">
              {list.length === 0 ? (
                <p className="empty">No games launched yet — be the first.</p>
              ) : (
                list.map((g) => (
                  <article key={g.token} className="game">
                    {g.coverImage && (
                      <div className="cover">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={g.coverImage} alt={`${g.name} cover`} loading="lazy" />
                      </div>
                    )}
                    <div className="gameBody">
                      <div className="gameTop">
                        {g.thumbnail && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="thumb" src={g.thumbnail} alt="" loading="lazy" />
                        )}
                        <strong>{g.name}</strong>
                        <span className="sym">{g.symbol}</span>
                      </div>
                      {g.description && <p className="desc">{g.description}</p>}
                      <div className="meta">
                        <span className="tag">{g.genre}</span>
                        <span className="mono">{fmt(g.supply)} supply</span>
                        <span className="dim">by {short(g.creator)}</span>
                      </div>
                      <div className="deploy">
                        <a
                          href={`${EXPLORER}/token/${g.token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="link"
                        >
                          <span className="linkLabel">Token contract</span>
                          <span className="mono addr">{short(g.token)}</span>
                          <span aria-hidden="true">↗</span>
                        </a>
                        {g.gameUrl && (
                          <a
                            href={g.gameUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link play"
                          >
                            <span className="linkLabel">Play game</span>
                            <span aria-hidden="true">↗</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      </PortalShell>

      <style jsx>{`
        .grid {
          display: grid;
          grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
          gap: 18px;
          align-items: start;
        }

        .panel {
          border-radius: var(--r-lg);
          background: rgba(13, 14, 18, 0.66);
          box-shadow: inset 0 0 0 1px var(--border), var(--shadow-md);
          backdrop-filter: blur(14px);
          padding: 22px;
        }

        h2 {
          margin: 0 0 16px;
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        .form {
          display: grid;
          gap: 14px;
        }

        label {
          display: grid;
          gap: 7px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-mute);
        }

        .row {
          display: flex;
          gap: 12px;
        }

        .grow {
          flex: 1;
        }

        input,
        select,
        textarea {
          width: 100%;
          padding: 12px 14px;
          border: 0;
          border-radius: var(--r-sm);
          background: rgba(0, 0, 0, 0.32);
          box-shadow: inset 0 0 0 1px var(--border);
          color: var(--text);
          font-family: var(--font-sans);
          font-size: 15px;
          font-weight: 500;
          letter-spacing: normal;
          text-transform: none;
          resize: none;
        }

        input::placeholder,
        textarea::placeholder {
          color: var(--text-mute);
        }

        input:focus,
        select:focus,
        textarea:focus {
          outline: none;
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand), transparent 40%);
        }

        .mono {
          font-family: var(--font-mono);
          letter-spacing: 0.04em;
        }

        select {
          appearance: none;
          cursor: pointer;
          min-width: 130px;
        }

        .supply {
          position: relative;
        }

        .supply span {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--text-mute);
          pointer-events: none;
        }

        .hint {
          margin: 0;
          font-size: 13px;
          font-weight: 500;
          letter-spacing: normal;
          text-transform: none;
          color: #fcd34d;
        }

        .success {
          margin: 0;
          padding: 11px 14px;
          border-radius: var(--r-sm);
          background: rgba(52, 211, 153, 0.12);
          box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.3);
          color: #6ee7b7;
          font-size: 13px;
          font-weight: 500;
          letter-spacing: normal;
          text-transform: none;
        }

        .launch {
          margin-top: 4px;
          height: 52px;
          border: 0;
          border-radius: var(--r-pill);
          background: linear-gradient(135deg, var(--brand-bright), #6b54e6);
          color: #fff;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 14px 30px rgba(131, 110, 249, 0.34);
          transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
        }

        .launch:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 18px 42px rgba(131, 110, 249, 0.46);
        }

        .launch:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .list {
          display: flex;
          flex-direction: column;
          min-height: 0;
          max-height: 64vh;
        }

        .listHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .listHead span {
          font-family: var(--font-mono);
          font-size: 13px;
          color: var(--text-mute);
          padding: 3px 10px;
          border-radius: var(--r-pill);
          box-shadow: inset 0 0 0 1px var(--border);
        }

        .rows {
          display: grid;
          gap: 10px;
          overflow-y: auto;
          scrollbar-width: thin;
          padding-right: 4px;
        }

        .empty {
          margin: 24px 0;
          text-align: center;
          color: var(--text-mute);
          font-size: 14px;
        }

        .previewRow {
          display: flex;
          gap: 10px;
          align-items: flex-end;
        }

        .coverPreview {
          flex: 1;
          min-width: 0;
          height: 96px;
          object-fit: cover;
          border-radius: var(--r-sm);
          box-shadow: inset 0 0 0 1px var(--border);
        }

        .thumbPreview {
          width: 72px;
          height: 96px;
          object-fit: cover;
          border-radius: var(--r-sm);
          box-shadow: inset 0 0 0 1px var(--border);
        }

        .game {
          border-radius: var(--r-md);
          overflow: hidden;
          background: var(--surface);
          box-shadow: inset 0 0 0 1px var(--border);
          transition: background 160ms ease;
        }

        .game:hover {
          background: var(--surface-strong);
        }

        .cover {
          height: 120px;
          background: rgba(0, 0, 0, 0.3);
        }

        .cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .gameBody {
          padding: 14px 16px;
        }

        .gameTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .thumb {
          width: 34px;
          height: 34px;
          flex: 0 0 auto;
          object-fit: cover;
          border-radius: var(--r-sm);
          box-shadow: inset 0 0 0 1px var(--border);
        }

        .gameTop strong {
          margin-right: auto;
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.01em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sym {
          flex: 0 0 auto;
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 600;
          color: var(--brand-bright);
          padding: 3px 9px;
          border-radius: var(--r-pill);
          background: color-mix(in srgb, var(--brand), transparent 84%);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand), transparent 55%);
        }

        .desc {
          margin: 8px 0 0;
          font-size: 13px;
          color: var(--text-dim);
          line-height: 1.4;
        }

        .meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px 14px;
          margin-top: 10px;
          font-size: 12px;
          color: var(--text-mute);
        }

        .meta .mono {
          font-family: var(--font-mono);
        }

        .tag {
          color: var(--text-dim);
          padding: 2px 8px;
          border-radius: var(--r-pill);
          box-shadow: inset 0 0 0 1px var(--border);
        }

        .deploy {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }

        .link {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 7px 11px;
          border-radius: var(--r-pill);
          background: color-mix(in srgb, var(--brand), transparent 88%);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand), transparent 60%);
          color: var(--brand-bright);
          text-decoration: none;
          font-size: 12px;
          font-weight: 600;
        }

        .link:hover {
          background: color-mix(in srgb, var(--brand), transparent 78%);
        }

        .link.play {
          background: rgba(52, 211, 153, 0.12);
          box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.3);
          color: #6ee7b7;
        }

        .link.play:hover {
          background: rgba(52, 211, 153, 0.2);
        }

        .linkLabel {
          font-weight: 600;
        }

        .addr {
          font-family: var(--font-mono);
          color: var(--text-dim);
        }

        @media (max-width: 860px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .list {
            max-height: none;
          }
        }
      `}</style>
    </>
  );
}
