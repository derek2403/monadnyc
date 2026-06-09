import { PageHeader } from "@/components/PageHeader";
import { PortalShell } from "@/components/PortalShell";
import { friends, games } from "@/components/portalData";
import Head from "next/head";

export default function FriendsPage() {
  const backgroundGame = games[3];
  const onlineCount = friends.filter((friend) => friend.online).length;

  return (
    <>
      <Head>
        <title>Friends | Monad Arcade</title>
      </Head>

      <PortalShell active="friends" accent={backgroundGame.accent} cover={backgroundGame.cover}>
        <PageHeader
          eyebrow="Friends"
          title="Squad activity"
          subtitle={`${onlineCount} of ${friends.length} friends online — jump into a session together.`}
        />

        <section className="friendsList" aria-label="Friends list">
          {friends.map((friend) => (
            <article key={friend.id} className="friendRow">
              <span className={`friendAvatar ${friend.online ? "online" : ""}`}>
                {friend.name.slice(0, 1)}
                {friend.online ? <span className="presence" aria-hidden="true" /> : null}
              </span>
              <div className="friendBody">
                <strong>{friend.name}</strong>
                <span>{friend.status}</span>
              </div>
              <button type="button" className={friend.online ? "primary" : ""}>
                {friend.online ? "Invite" : "Message"}
              </button>
            </article>
          ))}
        </section>
      </PortalShell>

      <style jsx>{`
        .friendsList {
          display: grid;
          gap: 12px;
          max-width: 880px;
        }

        .friendRow {
          min-height: 78px;
          border-radius: var(--r-pill);
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 16px;
          padding: 12px 16px;
          background: rgba(13, 14, 18, 0.6);
          box-shadow: inset 0 0 0 1px var(--border), var(--shadow-sm);
          backdrop-filter: blur(14px);
          transition: transform 180ms ease, box-shadow 180ms ease;
        }

        .friendRow:hover {
          transform: translateY(-2px);
          box-shadow: inset 0 0 0 1px var(--border-strong), 0 18px 36px rgba(0, 0, 0, 0.34);
        }

        .friendAvatar {
          position: relative;
          width: 52px;
          height: 52px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          color: rgba(255, 255, 255, 0.86);
          background: var(--surface-strong);
          box-shadow: inset 0 0 0 1px var(--border);
          font-weight: 600;
          font-size: 18px;
        }

        .friendAvatar.online {
          color: #0a0a0c;
          background: linear-gradient(140deg, #a594ff, #20f4c7);
          box-shadow: 0 0 22px rgba(131, 110, 249, 0.35);
        }

        .presence {
          position: absolute;
          right: -1px;
          bottom: -1px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #34d399;
          box-shadow: 0 0 0 3px rgba(13, 14, 18, 0.9);
        }

        .friendBody {
          display: grid;
          gap: 3px;
          min-width: 0;
        }

        .friendBody strong,
        .friendBody span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .friendBody strong {
          font-size: 17px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        .friendBody span {
          color: var(--text-mute);
          font-size: 13px;
        }

        .friendRow button {
          border: 0;
          min-width: 102px;
          height: 42px;
          padding: 0 18px;
          border-radius: var(--r-pill);
          color: var(--text);
          background: var(--surface-strong);
          box-shadow: inset 0 0 0 1px var(--border);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 160ms ease, background 160ms ease;
        }

        .friendRow button:hover {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.12);
        }

        .friendRow button.primary {
          color: #0a0a0c;
          background: #fff;
          box-shadow: none;
        }

        @media (max-width: 560px) {
          .friendRow {
            border-radius: var(--r-lg);
            grid-template-columns: auto minmax(0, 1fr);
          }

          .friendRow button {
            grid-column: 1 / -1;
            width: 100%;
          }
        }
      `}</style>
    </>
  );
}
