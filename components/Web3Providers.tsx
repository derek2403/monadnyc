import { connectorsForWallets, darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet, metaMaskWallet, rabbyWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useState } from "react";
import { defineChain } from "viem";
import { createConfig, http, WagmiProvider } from "wagmi";

// Prefer a dedicated RPC (e.g. Alchemy) when provided — the public endpoint is
// shared and capped at ~15 req/sec, which throttles reads and settlement.
const RPC_URL =
  process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Monad",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: [RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://testnet.monadexplorer.com",
    },
  },
  // Canonical Multicall3 (deployed on Monad testnet). Lets wagmi batch many
  // contract reads — e.g. ownerOf() across every trophy on the Inventory page —
  // into ONE eth_call so we don't blow past the RPC's 15 req/sec limit.
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "MONAD_ARCADE_BROWSER_WALLETS";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [metaMaskWallet, rabbyWallet, coinbaseWallet, injectedWallet],
    },
  ],
  {
    appName: "Monad Arcade",
    projectId: walletConnectProjectId,
  },
);

const wagmiConfig = createConfig({
  chains: [monadTestnet],
  connectors,
  ssr: true,
  transports: {
    // batch: collapse concurrent JSON-RPC calls into a single HTTP request,
    // further easing rate limits on the public endpoint.
    [monadTestnet.id]: http(RPC_URL, { batch: true }),
  },
});

export function Web3Providers({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={monadTestnet}
          modalSize="compact"
          showRecentTransactions={false}
          theme={darkTheme({
            accentColor: "#20e7c2",
            accentColorForeground: "#111111",
            borderRadius: "medium",
            fontStack: "system",
            overlayBlur: "small",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
