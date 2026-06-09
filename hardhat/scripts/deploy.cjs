const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

function buildTokenUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a1a55"/>
      <stop offset="0.6" stop-color="#6d3ab0"/>
      <stop offset="1" stop-color="#0a0812"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.2" r="0.8">
      <stop offset="0" stop-color="#c084fc" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#c084fc" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="600" height="600" rx="48" fill="url(#bg)"/>
  <rect width="600" height="600" rx="48" fill="url(#glow)"/>
  <text x="300" y="300" font-family="Arial, sans-serif" font-size="200" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">67</text>
  <text x="300" y="430" font-family="Arial, sans-serif" font-size="42" font-weight="bold" letter-spacing="6" fill="#c084fc" text-anchor="middle">MASTER</text>
  <text x="300" y="520" font-family="Arial, sans-serif" font-size="22" letter-spacing="3" fill="#a78bfa" text-anchor="middle" opacity="0.8">MONAD ARCADE</text>
</svg>`;
  const image = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  const json = JSON.stringify({
    name: "Six Seven Master",
    description:
      "Awarded to the winner of a What's 67? match in the Monad Arcade.",
    image,
  });
  return "data:application/json;base64," + Buffer.from(json).toString("base64");
}

function buildCollarUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5a3410"/>
      <stop offset="0.6" stop-color="#b45309"/>
      <stop offset="1" stop-color="#120a04"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.32" r="0.8">
      <stop offset="0" stop-color="#fbbf24" stop-opacity="0.65"/>
      <stop offset="1" stop-color="#fbbf24" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fde68a"/>
      <stop offset="1" stop-color="#d97706"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" rx="48" fill="url(#bg)"/>
  <rect width="600" height="600" rx="48" fill="url(#glow)"/>
  <!-- collar band -->
  <path d="M70 300 A230 230 0 0 0 530 300" fill="none" stroke="#7c2d12" stroke-width="56"/>
  <path d="M70 300 A230 230 0 0 0 530 300" fill="none" stroke="url(#gold)" stroke-width="40"/>
  <!-- studs -->
  <circle cx="150" cy="372" r="11" fill="#fffbeb"/>
  <circle cx="230" cy="430" r="11" fill="#fffbeb"/>
  <circle cx="370" cy="430" r="11" fill="#fffbeb"/>
  <circle cx="450" cy="372" r="11" fill="#fffbeb"/>
  <!-- tag -->
  <circle cx="300" cy="468" r="62" fill="url(#gold)" stroke="#7c2d12" stroke-width="6"/>
  <text x="300" y="486" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="#7c2d12" text-anchor="middle">🐾</text>
  <text x="300" y="190" font-family="Arial, sans-serif" font-size="120" font-weight="bold" fill="#ffffff" text-anchor="middle">🏆</text>
  <text x="300" y="262" font-family="Arial, sans-serif" font-size="40" font-weight="bold" letter-spacing="5" fill="#fde68a" text-anchor="middle">GOLDEN COLLAR</text>
  <text x="300" y="556" font-family="Arial, sans-serif" font-size="22" letter-spacing="3" fill="#fbbf24" text-anchor="middle" opacity="0.85">BARK BATTLE · MONAD ARCADE</text>
</svg>`;
  const image = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  const json = JSON.stringify({
    name: "Golden Collar",
    description: "Awarded to the winner of a Bark Battle match in the Monad Arcade.",
    image,
  });
  return "data:application/json;base64," + Buffer.from(json).toString("base64");
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  console.log("Network:", net.name, "chainId", net.chainId.toString());
  console.log("Deployer:", deployer.address);
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal), "MON\n");

  // 1. NFT
  const Master = await hre.ethers.getContractFactory("SixSevenMaster");
  const nft = await Master.deploy(buildTokenUri());
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  console.log("SixSevenMaster:", nftAddress);

  // 2. Vault
  const Vault = await hre.ethers.getContractFactory("SixSevenVault");
  const vault = await Vault.deploy(nftAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("SixSevenVault: ", vaultAddress);

  // 3. Authorize vault to mint trophies
  const tx = await nft.setMinter(vaultAddress);
  await tx.wait();
  console.log("Vault set as NFT minter");

  // 4. Golden Collar trophy + Bark vault. Same escrow as the 67 vault, but
  //    wired to its own NFT so the bark winner takes the pot AND mints a collar.
  const Collar = await hre.ethers.getContractFactory("GoldenCollar");
  const collar = await Collar.deploy(buildCollarUri());
  await collar.waitForDeployment();
  const collarAddress = await collar.getAddress();
  console.log("GoldenCollar:  ", collarAddress);

  const barkVault = await Vault.deploy(collarAddress);
  await barkVault.waitForDeployment();
  const barkVaultAddress = await barkVault.getAddress();
  console.log("BarkVault:     ", barkVaultAddress);

  const tx2 = await collar.setMinter(barkVaultAddress);
  await tx2.wait();
  console.log("Bark vault set as Golden Collar minter");

  // 5. Game launchpad (ERC-20 factory + on-chain registry)
  const Launchpad = await hre.ethers.getContractFactory("GameLaunchpad");
  const launchpad = await Launchpad.deploy();
  await launchpad.waitForDeployment();
  const launchpadAddress = await launchpad.getAddress();
  console.log("GameLaunchpad: ", launchpadAddress, "\n");

  // Write config for the app + server
  const nftAbi = (await hre.artifacts.readArtifact("SixSevenMaster")).abi;
  const collarAbi = (await hre.artifacts.readArtifact("GoldenCollar")).abi;
  const vaultAbi = (await hre.artifacts.readArtifact("SixSevenVault")).abi;
  const launchpadAbi = (await hre.artifacts.readArtifact("GameLaunchpad")).abi;
  const chainId = Number(net.chainId);

  const root = path.resolve(__dirname, "..", "..");

  const deployments = {
    chainId,
    nft: nftAddress,
    collar: collarAddress,
    vault: vaultAddress,
    barkVault: barkVaultAddress,
    launchpad: launchpadAddress,
    deployer: deployer.address,
    nftAbi,
    collarAbi,
    vaultAbi,
    launchpadAbi,
  };
  fs.mkdirSync(path.join(root, "deployments"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "deployments", "contracts.json"),
    JSON.stringify(deployments, null, 2),
  );
  console.log("Wrote deployments/contracts.json");

  const ts = `// AUTO-GENERATED by hardhat/scripts/deploy.cjs — do not edit by hand.
import { keccak256, toBytes } from "viem";

export const MONAD_CHAIN_ID = ${chainId};
export const NFT_ADDRESS = "${nftAddress}" as const;
export const COLLAR_ADDRESS = "${collarAddress}" as const;
export const VAULT_ADDRESS = "${vaultAddress}" as const;
export const BARK_VAULT_ADDRESS = "${barkVaultAddress}" as const;
export const LAUNCHPAD_ADDRESS = "${launchpadAddress}" as const;

/** Match id derived from a room code, shared by client and server. */
export const matchIdFromCode = (code: string) =>
  keccak256(toBytes(code.toUpperCase()));

export const VAULT_ABI = ${JSON.stringify(vaultAbi)} as const;
export const NFT_ABI = ${JSON.stringify(nftAbi)} as const;
export const COLLAR_ABI = ${JSON.stringify(collarAbi)} as const;
export const LAUNCHPAD_ABI = ${JSON.stringify(launchpadAbi)} as const;
`;
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "contracts.ts"), ts);
  console.log("Wrote lib/contracts.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
