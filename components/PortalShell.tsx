import { MonadWalletButton } from "@/components/MonadWalletButton";
import type { PortalSection } from "@/components/portalData";
import Link from "next/link";
import type { CSSProperties, PropsWithChildren } from "react";

type PortalShellProps = PropsWithChildren<{
  active: PortalSection;
  cover: string;
  accent: string;
}>;

type ShellStyle = CSSProperties & {
  "--cover": string;
  "--accent": string;
};

// Library sits in the center as the Monad Arcade logo and links home ("/").
const navItems: Array<{ id: PortalSection; label: string; href: string }> = [
  { id: "store", label: "Store", href: "/store" },
  { id: "inventories", label: "Inventory", href: "/inventories" },
  { id: "library", label: "Library", href: "/" },
  { id: "friends", label: "Friends", href: "/friends" },
  { id: "power", label: "Host", href: "/power" },
];

function NavIcon({ type }: { type: PortalSection }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (type) {
    case "library":
      return (
        <svg {...common} aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="15" rx="3" />
          <path d="M10 9.5 14.5 12 10 14.5V9.5Z" />
        </svg>
      );
    case "store":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M5 8h14l-1 11.4a1 1 0 0 1-1 .9H7a1 1 0 0 1-1-.9L5 8Z" />
          <path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" />
        </svg>
      );
    case "inventories":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" />
          <path d="M4 7.5 12 12l8-4.5" />
          <path d="M12 12v9" />
        </svg>
      );
    case "friends":
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="9" cy="9" r="3" />
          <path d="M3.8 19a5.2 5.2 0 0 1 10.4 0" />
          <path d="M15.5 7.2a3 3 0 0 1 0 5.6" />
          <path d="M16.2 14.4a5.2 5.2 0 0 1 4 4.6" />
        </svg>
      );
    case "power":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 2.5c2.5 2.5 3 6.5 2 10.5l-2 1.5-2-1.5c-1-4-.5-8 2-10.5Z" />
          <circle cx="12" cy="8" r="1.6" />
          <path d="M10 13.5 7.5 15.5l1.8-.4M14 13.5l2.5 2-1.8-.4" />
          <path d="M10.8 14.6c.2 1.8 1.2 3.4 1.2 3.4s1-1.6 1.2-3.4" />
        </svg>
      );
  }
}

export function PortalShell({ active, cover, accent, children }: PortalShellProps) {
  // The immersive cover art is reserved for the Library. Every other section
  // uses a calm, solid backdrop so the content reads cleanly.
  const showArt = active === "library";

  return (
    <main
      className={`portal ${showArt ? "withArt" : "plain"}`}
      style={{ "--cover": cover, "--accent": accent } as ShellStyle}
    >
      {showArt ? (
        <>
          <div className="backgroundArt" aria-hidden="true" />
          <div className="accentGlow" aria-hidden="true" />
          <div className="screenShade" aria-hidden="true" />
          <div className="grain" aria-hidden="true" />
        </>
      ) : (
        <div className="plainGlow" aria-hidden="true" />
      )}

      <header className="topBar">
        <MonadWalletButton />
      </header>

      <div className="content">{children}</div>

      <nav className="ecosystemNav" aria-label="Portal sections">
        <div className="dock">
          {navItems.map((item) => (
            <Link
              key={item.id}
              className={`navLink ${active === item.id ? "active" : ""}`}
              href={item.href}
              aria-current={active === item.id ? "page" : undefined}
            >
              <NavIcon type={item.id} />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <style jsx>{`
        .portal {
          position: relative;
          height: 100vh;
          height: 100dvh;
          overflow: hidden;
          color: var(--text);
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          padding: clamp(16px, 2.4vw, 30px) clamp(20px, 4vw, 52px)
            clamp(16px, 2.4vw, 30px);
          font-family: var(--font-sans);
        }

        .portal.plain {
          background:
            radial-gradient(120% 80% at 50% -10%, #14131c 0%, transparent 60%),
            var(--bg);
        }

        /* A faint accent wash up top keeps non-Library pages from feeling flat
           without the heavy cover art. */
        .plainGlow {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            70% 50% at 84% 0%,
            color-mix(in srgb, var(--accent), transparent 86%) 0%,
            transparent 60%
          );
          pointer-events: none;
        }

        .backgroundArt {
          position: absolute;
          inset: 0;
          background: var(--cover);
          background-size: cover;
          background-position: center;
          transform: scale(1.06);
          animation: drift 32s ease-in-out infinite alternate;
        }

        .accentGlow {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            60% 50% at 82% 4%,
            color-mix(in srgb, var(--accent), transparent 62%) 0%,
            transparent 70%
          );
          mix-blend-mode: screen;
          opacity: 0.7;
        }

        .screenShade {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(
              180deg,
              rgba(6, 7, 10, 0.55) 0%,
              rgba(6, 7, 10, 0.12) 30%,
              rgba(6, 7, 10, 0.62) 74%,
              rgba(6, 7, 10, 0.9) 100%
            ),
            linear-gradient(90deg, rgba(6, 7, 10, 0.72) 0%, transparent 46%),
            radial-gradient(120% 90% at 50% 50%, transparent 58%, rgba(4, 5, 8, 0.7) 100%);
        }

        .grain {
          position: absolute;
          inset: 0;
          opacity: 0.05;
          mix-blend-mode: soft-light;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }

        .topBar,
        .content,
        .ecosystemNav {
          position: relative;
          z-index: 1;
        }

        .topBar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 16px;
        }

        .content {
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          padding: clamp(18px, 3vh, 44px) 0 20px;
          overflow-y: auto;
          scrollbar-width: none;
          animation: rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        .content::-webkit-scrollbar {
          display: none;
        }

        .ecosystemNav {
          display: flex;
          justify-content: center;
        }

        .dock {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px;
          border-radius: var(--r-pill);
          background: rgba(14, 15, 19, 0.62);
          box-shadow: inset 0 0 0 1px var(--border), var(--shadow-md);
          backdrop-filter: blur(20px) saturate(1.2);
          overflow-x: auto;
          scrollbar-width: none;
          max-width: 100%;
        }

        .dock::-webkit-scrollbar {
          display: none;
        }

        :global(.navLink) {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          height: 50px;
          padding: 0 20px;
          border-radius: var(--r-pill);
          color: var(--text-dim);
          text-decoration: none;
          white-space: nowrap;
          transition: color 180ms ease, background 180ms ease, box-shadow 180ms ease;
        }

        :global(.navLink:hover) {
          color: var(--text);
          background: var(--surface-strong);
        }

        :global(.navLink.active) {
          color: #fff;
          background: color-mix(in srgb, var(--accent), transparent 80%);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent), transparent 40%),
            0 8px 22px color-mix(in srgb, var(--accent), transparent 70%);
        }

        :global(.navLink span) {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        @keyframes drift {
          from {
            transform: scale(1.06) translate3d(0, 0, 0);
          }
          to {
            transform: scale(1.1) translate3d(-1.4%, -1%, 0);
          }
        }

        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (max-width: 760px) {
          .topBar {
            align-items: center;
          }

          :global(.navLink) {
            width: 52px;
            justify-content: center;
            gap: 0;
            padding: 0;
          }

          :global(.navLink span) {
            display: none;
          }

          .dock {
            gap: 4px;
          }
        }
      `}</style>
    </main>
  );
}
