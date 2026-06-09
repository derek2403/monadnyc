import "@/styles/globals.css";
import "@rainbow-me/rainbowkit/styles.css";

import { Web3Providers } from "@/components/Web3Providers";
import { Geist, Geist_Mono } from "next/font/google";
import type { AppProps } from "next/app";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${geistSans.variable} ${geistMono.variable}`}>
      <Web3Providers>
        <Component {...pageProps} />
      </Web3Providers>
    </div>
  );
}
