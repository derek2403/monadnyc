import Head from "next/head";
import { useRouter } from "next/router";
import { useState } from "react";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(len = 6) {
  let s = "";
  const buf = new Uint8Array(len);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < len; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length];
  return s;
}

export default function BarkLanding() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");

  const create = () => {
    router.push(`/bark/${generateCode()}`);
  };

  const join = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return;
    router.push(`/bark/${code}`);
  };

  return (
    <>
      <Head>
        <title>bark battle</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-gradient-to-b from-amber-900 via-orange-800 to-amber-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-2 text-7xl select-none">🐕</div>
          <h1 className="text-5xl sm:text-6xl font-black tracking-tight text-center mb-3">
            <span className="bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">
              BARK BATTLE
            </span>
          </h1>
          <p className="text-center text-amber-200/80 mb-10">
            Two players. 20 seconds. Loudest barks win.
          </p>

          <button
            onClick={create}
            className="w-full mb-6 py-4 bg-amber-400 hover:bg-amber-300 rounded-xl font-black text-amber-950 text-lg uppercase tracking-wider transition-colors shadow-lg shadow-amber-900/40"
          >
            Create room
          </button>

          <div className="flex items-center gap-3 mb-4 text-xs uppercase tracking-widest text-amber-200/50">
            <div className="flex-1 h-px bg-amber-200/20" />
            <span>or join</span>
            <div className="flex-1 h-px bg-amber-200/20" />
          </div>

          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) =>
                setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") join();
              }}
              maxLength={8}
              placeholder="CODE"
              className="flex-1 px-4 py-3 bg-amber-950/60 border border-amber-700/60 rounded-xl font-mono text-lg tracking-[0.3em] text-center focus:outline-none focus:border-amber-400"
            />
            <button
              onClick={join}
              disabled={joinCode.trim().length < 4}
              className="px-5 py-3 bg-amber-950/60 hover:bg-amber-900 border border-amber-700/60 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-bold transition-colors"
            >
              Join
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
