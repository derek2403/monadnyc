require("@nomicfoundation/hardhat-ethers");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const RAW = (process.env.PRIVATE_KEY || "").trim();
const PRIVATE_KEY = RAW ? (RAW.startsWith("0x") ? RAW : `0x${RAW}`) : "";

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    monadTestnet: {
      url: "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};
