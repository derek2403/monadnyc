import { ConnectButton } from "@rainbow-me/rainbowkit";

export function MonadWalletButton() {
  return (
    <>
      <ConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openChainModal,
          openConnectModal,
          authenticationStatus,
          mounted,
        }) => {
          const ready = mounted && authenticationStatus !== "loading";
          const connected =
            ready &&
            account &&
            chain &&
            (!authenticationStatus || authenticationStatus === "authenticated");

          let label = "Connect Wallet";
          let onClick = openConnectModal;
          let isConnected = false;
          let avatarUrl = "";

          if (connected && chain.unsupported) {
            label = "Switch Network";
            onClick = openChainModal;
          } else if (connected) {
            onClick = openAccountModal;
            isConnected = true;
            avatarUrl = account.ensAvatar ?? "";
          }

          return (
            <button
              aria-hidden={!ready}
              className={`walletButton ${isConnected ? "isConnected" : ""}`}
              disabled={!ready}
              onClick={onClick}
              type="button"
              title={isConnected ? "Open wallet account" : "Connect wallet"}
            >
              {isConnected ? (
                <span
                  className={`profileAvatar ${avatarUrl ? "hasImage" : ""}`}
                  aria-hidden="true"
                  style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
                />
              ) : (
                <span>{label}</span>
              )}
            </button>
          );
        }}
      </ConnectButton.Custom>

      <style jsx>{`
        .walletButton {
          border: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--text);
          background: rgba(14, 15, 19, 0.55);
          box-shadow: inset 0 0 0 1px var(--border), var(--shadow-sm);
          backdrop-filter: blur(16px);
          min-height: 48px;
          padding: 0 22px;
          border-radius: var(--r-pill);
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.01em;
          cursor: pointer;
          transition: transform 160ms ease, background 160ms ease, box-shadow 160ms ease;
        }

        .walletButton:hover {
          transform: translateY(-1px);
          background: rgba(20, 21, 26, 0.78);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand), transparent 45%),
            0 10px 26px rgba(131, 110, 249, 0.24);
        }

        .walletButton:disabled {
          cursor: progress;
          opacity: 0.7;
        }

        .walletButton.isConnected {
          width: 52px;
          height: 52px;
          min-height: 52px;
          padding: 0;
          justify-content: center;
        }

        .profileAvatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          overflow: hidden;
        }

        .profileAvatar {
          position: relative;
          background:
            radial-gradient(circle at 28% 24%, rgba(255, 255, 255, 0.92) 0 10%, transparent 11%),
            linear-gradient(135deg, #a594ff, #6b54e6 52%, #20f4c7);
          box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.34);
        }

        .profileAvatar::before,
        .profileAvatar::after {
          content: "";
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(17, 18, 20, 0.78);
        }

        .profileAvatar::before {
          top: 9px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
        }

        .profileAvatar::after {
          bottom: 8px;
          width: 27px;
          height: 16px;
          border-radius: 16px 16px 8px 8px;
        }

        .profileAvatar.hasImage {
          background-position: center;
          background-size: cover;
        }

        .profileAvatar.hasImage::before,
        .profileAvatar.hasImage::after {
          content: none;
        }
      `}</style>
    </>
  );
}
