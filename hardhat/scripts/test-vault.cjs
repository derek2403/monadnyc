const hre = require("hardhat");
const assert = require("node:assert");

const { ethers } = hre;
const id = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const STAKE = ethers.parseEther("1");

async function playAndResolve(vault, host, guest, owner, room) {
  const mid = id(room);
  await (await vault.connect(host).createMatch(mid, { value: STAKE })).wait();
  await (await vault.connect(guest).joinMatch(mid, { value: STAKE })).wait();
  const before = await ethers.provider.getBalance(guest.address);
  await (await vault.connect(owner).resolve(mid, 1)).wait(); // role 1 = guest wins
  const after = await ethers.provider.getBalance(guest.address);
  const m = await vault.getMatch(mid);
  assert.strictEqual(Number(m[4]), 3, "status should be Resolved");
  assert(after - before > ethers.parseEther("1.9"), "winner should receive the ~2 MON pot");
  return after - before;
}

async function main() {
  const [owner, alice, bob] = await ethers.getSigners();
  const Vault = await ethers.getContractFactory("SixSevenVault");

  // 1) No-NFT vault (bark): must settle without reverting.
  const barkVault = await Vault.deploy(ethers.ZeroAddress);
  await barkVault.waitForDeployment();
  const g1 = await playAndResolve(barkVault, alice, bob, owner, "BARKROOM");
  console.log("no-NFT vault: winner +", ethers.formatEther(g1), "MON ✓");

  // 2) With-NFT vault (67): settles AND mints a trophy.
  const Nft = await ethers.getContractFactory("SixSevenMaster");
  const nft = await Nft.deploy("data:application/json,{}");
  await nft.waitForDeployment();
  const vault = await Vault.deploy(await nft.getAddress());
  await vault.waitForDeployment();
  await (await nft.setMinter(await vault.getAddress())).wait();
  const g2 = await playAndResolve(vault, alice, bob, owner, "SIXROOM");
  const minted = await nft.balanceOf(bob.address);
  assert.strictEqual(minted, 1n, "winner should hold 1 trophy");
  console.log("with-NFT vault: winner +", ethers.formatEther(g2), "MON + ", minted.toString(), "NFT ✓");

  console.log("\nPASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
