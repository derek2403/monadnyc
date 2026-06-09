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

export default function SixSevenLanding() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");

  const create = () => {
    router.push(`/sixseven/${generateCode()}`);
  };

  const join = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return;
    router.push(`/sixseven/${code}`);
  };

  return (
    <>
      <Head>
        <title>six seven</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-center mb-3">
            <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
              six seven
            </span>
          </h1>
          <p className="text-center text-zinc-400 mb-10">
            Two-player gesture battle. Create a room, share the link, swing those hands.
          </p>

          <button
            onClick={create}
            className="w-full mb-6 py-4 bg-emerald-500 hover:bg-emerald-400 rounded-xl font-bold text-black text-lg transition-colors"
          >
            Create room
          </button>

          <div className="flex items-center gap-3 mb-4 text-xs uppercase tracking-widest text-zinc-500">
            <div className="flex-1 h-px bg-zinc-800" />
            <span>or join</span>
            <div className="flex-1 h-px bg-zinc-800" />
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
              className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl font-mono text-lg tracking-[0.3em] text-center focus:outline-none focus:border-zinc-500"
            />
            <button
              onClick={join}
              disabled={joinCode.trim().length < 4}
              className="px-5 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-bold transition-colors"
            >
              Join
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
