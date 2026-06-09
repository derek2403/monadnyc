type PageHeaderProps = {
  eyebrow: string;
  title: string;
  subtitle?: string;
};

/** Shared section header used across Store, Inventories, Friends and Power. */
export function PageHeader({ eyebrow, title, subtitle }: PageHeaderProps) {
  return (
    <header className="pageHeader">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}

      <style jsx>{`
        .pageHeader {
          margin-bottom: 30px;
        }

        .eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: var(--r-pill);
          background: var(--surface);
          box-shadow: inset 0 0 0 1px var(--border);
          color: color-mix(in srgb, var(--accent, var(--brand)), #ffffff 26%);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          backdrop-filter: blur(8px);
        }

        .eyebrow::before {
          content: "";
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--accent, var(--brand));
          box-shadow: 0 0 12px var(--accent, var(--brand));
        }

        h1 {
          margin: 16px 0 0;
          font-size: clamp(38px, 6.4vw, 76px);
          line-height: 1;
          letter-spacing: -0.03em;
          font-weight: 700;
          text-shadow: 0 14px 40px rgba(0, 0, 0, 0.55);
        }

        p {
          margin: 16px 0 0;
          max-width: 540px;
          color: var(--text-dim);
          font-size: clamp(15px, 1.6vw, 18px);
          line-height: 1.5;
        }
      `}</style>
    </header>
  );
}
