export type PortalSection = "library" | "store" | "inventories" | "friends" | "power";

export type Game = {
  id: string;
  name: string;
  category: string;
  studio: string;
  tagline: string;
  cover: string;
  thumbnail: string;
  accent: string;
  players: string;
  inventory: string[];
  /** Set on playable titles — the route launched by the Play button. */
  route?: string;
};

export const games: Game[] = [
  {
    id: "whats-67",
    name: "What's 67?",
    category: "Multiplayer Party",
    studio: "Monad Arcade",
    tagline: "Two players, one camera each. Do the 6-7 seesaw fastest in 20 seconds.",
    cover:
      "url('/covers/whats-67.jpg'), radial-gradient(135% 120% at 50% 8%, rgba(192,132,252,0.5) 0%, rgba(34,211,238,0.14) 42%, transparent 64%), linear-gradient(160deg, #0b0816 0%, #2a1a55 38%, #5b3aa6 68%, #0a0812 100%)",
    thumbnail:
      "url('/thumbs/whats-67.jpg'), radial-gradient(120% 95% at 50% 16%, rgba(192,132,252,0.6) 0%, transparent 56%), linear-gradient(150deg, #2a1a55 0%, #6d3ab0 70%, #0a0812 100%)",
    accent: "#c084fc",
    players: "67",
    inventory: ["67 Badge", "Combo Trail", "Winner Crown"],
    route: "/sixseven",
  },
  {
    id: "bark-battle",
    name: "Bark Battle",
    category: "Multiplayer Party",
    studio: "Monad Arcade",
    tagline: "Two players, 20 seconds, loudest barks win. Stake MON — winner takes the pot.",
    cover:
      "url('/covers/bark-battle.jpg'), radial-gradient(135% 120% at 50% 8%, rgba(251,191,36,0.5) 0%, rgba(249,115,22,0.14) 42%, transparent 64%), linear-gradient(160deg, #1a1206 0%, #5a3410 38%, #b45309 68%, #120a04 100%)",
    thumbnail:
      "url('/thumbs/bark-battle.jpg'), radial-gradient(120% 95% at 50% 16%, rgba(251,191,36,0.6) 0%, transparent 56%), linear-gradient(150deg, #5a3410 0%, #b45309 70%, #120a04 100%)",
    accent: "#fbbf24",
    players: "20",
    inventory: ["Golden Collar", "Loud Trophy", "Top Dog Tag"],
    route: "/bark",
  },
  {
    id: "skyward-realms",
    name: "Skyward Realms",
    category: "Open World Adventure",
    studio: "Monad Studios",
    tagline: "Chart the floating isles, claim the skies, and trade relics fully on-chain.",
    cover:
      "url('/covers/skyward-realms.jpg'), radial-gradient(135% 120% at 78% 8%, rgba(120,224,255,0.5) 0%, rgba(43,110,255,0.12) 38%, transparent 64%), linear-gradient(157deg, #050d1b 0%, #0d2440 34%, #1a5c84 66%, #060f1a 100%)",
    thumbnail:
      "url('/thumbs/skyward-realms.jpg'), radial-gradient(120% 95% at 76% 16%, rgba(120,224,255,0.6) 0%, transparent 56%), linear-gradient(150deg, #0a1c33 0%, #16517a 62%, #081320 100%)",
    accent: "#35d4ff",
    players: "18.2k",
    inventory: ["Glider Skin", "Cliff Token", "Rare Map"],
  },
  {
    id: "rift-racers",
    name: "Rift Racers",
    category: "Racing",
    studio: "Turbo Monad",
    tagline: "Burn through dimensional circuits and mint every podium finish.",
    cover:
      "url('/covers/rift-racers.jpg'), radial-gradient(135% 120% at 22% 12%, rgba(255,186,96,0.46) 0%, rgba(255,82,60,0.14) 40%, transparent 66%), linear-gradient(152deg, #150a10 0%, #46131f 32%, #c2472b 66%, #110a0d 100%)",
    thumbnail:
      "url('/thumbs/rift-racers.jpg'), radial-gradient(120% 95% at 24% 18%, rgba(255,196,110,0.62) 0%, transparent 56%), linear-gradient(150deg, #2a0e16 0%, #c2472b 70%, #160a0d 100%)",
    accent: "#ff7a4d",
    players: "9.8k",
    inventory: ["Nitro Pack", "Monad Kart", "Track Pass"],
  },
  {
    id: "chain-quest",
    name: "Chain Quest",
    category: "RPG",
    studio: "Hashlight",
    tagline: "Forge guilds, raid dungeons, and own every drop you earn.",
    cover:
      "url('/covers/chain-quest.jpg'), radial-gradient(135% 120% at 76% 12%, rgba(120,245,184,0.44) 0%, rgba(20,120,90,0.12) 40%, transparent 64%), linear-gradient(157deg, #03110d 0%, #0a3a2c 36%, #11785a 66%, #05130f 100%)",
    thumbnail:
      "url('/thumbs/chain-quest.jpg'), radial-gradient(120% 95% at 74% 16%, rgba(120,245,184,0.58) 0%, transparent 56%), linear-gradient(150deg, #08261d 0%, #11785a 64%, #06140f 100%)",
    accent: "#35e0a1",
    players: "6.1k",
    inventory: ["Chainblade", "Forest Rune", "Guild Badge"],
  },
  {
    id: "arena-zero",
    name: "Arena Zero",
    category: "Battle Arena",
    studio: "Zero Labs",
    tagline: "Five-on-five tactical combat with provably fair ranked ladders.",
    cover:
      "url('/covers/arena-zero.jpg'), radial-gradient(135% 120% at 72% 10%, rgba(255,156,86,0.42) 0%, rgba(120,60,30,0.12) 40%, transparent 62%), linear-gradient(157deg, #090b11 0%, #1d2433 34%, #7a3a1e 64%, #090a0f 100%)",
    thumbnail:
      "url('/thumbs/arena-zero.jpg'), radial-gradient(120% 95% at 74% 16%, rgba(255,166,96,0.5) 0%, transparent 56%), linear-gradient(150deg, #141a26 0%, #7a3a1e 70%, #090a0f 100%)",
    accent: "#f97316",
    players: "12.4k",
    inventory: ["Arena Pass", "Pulse Rifle", "Victory Emote"],
  },
];

export type StoreItem = {
  id: string;
  title: string;
  tag: string;
  price: string;
  accent: string;
  description: string;
};

export const storeItems: StoreItem[] = [
  {
    id: "season-pass",
    title: "Season Pass",
    tag: "Featured",
    price: "0.08 MON",
    accent: "#35d4ff",
    description: "Unlock every ranked reward track for the current season.",
  },
  {
    id: "creator-maps",
    title: "Creator Map Pack",
    tag: "Maps",
    price: "0.03 MON",
    accent: "#35e0a1",
    description: "Twelve community-built arenas, voted in by the guild.",
  },
  {
    id: "neon-bundle",
    title: "Neon Bundle",
    tag: "Cosmetic",
    price: "0.05 MON",
    accent: "#22d3ee",
    description: "Glow trails, emotes, and a limited profile frame.",
  },
  {
    id: "arena-ticket",
    title: "Arena Ticket",
    tag: "Competitive",
    price: "0.01 MON",
    accent: "#f97316",
    description: "One seat in the next on-chain ranked tournament.",
  },
];

export type Friend = {
  id: string;
  name: string;
  status: string;
  online: boolean;
};

export const friends: Friend[] = [
  { id: "nova", name: "Nova", status: "Playing Rift Racers", online: true },
  { id: "kai", name: "Kai", status: "Browsing Store", online: true },
  { id: "mira", name: "Mira", status: "Last online 2h ago", online: false },
  { id: "zen", name: "Zen", status: "In Chain Quest", online: true },
];

export type PowerAction = {
  id: string;
  title: string;
  description: string;
};

export const powerActions: PowerAction[] = [
  { id: "sleep", title: "Sleep Portal", description: "Dim the arcade shell and keep wallet state ready." },
  { id: "restart", title: "Restart Session", description: "Reset selected games and refresh mock portal data." },
  { id: "disconnect", title: "Wallet Settings", description: "Open your wallet profile from the top-left avatar." },
];
