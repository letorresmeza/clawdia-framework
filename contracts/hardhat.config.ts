import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const PRIVATE_KEY = process.env["DEPLOYER_PRIVATE_KEY"] ?? "0x" + "0".repeat(64);
const BASE_SEPOLIA_RPC = process.env["BASE_SEPOLIA_RPC"] ?? "https://sepolia.base.org";
const BASE_MAINNET_RPC = process.env["BASE_MAINNET_RPC"] ?? "https://mainnet.base.org";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC,
      chainId: 84532,
      accounts: [PRIVATE_KEY],
    },
    baseMainnet: {
      url: BASE_MAINNET_RPC,
      chainId: 8453,
      accounts: [PRIVATE_KEY],
    },
  },

  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  gasReporter: {
    enabled: process.env["REPORT_GAS"] === "true",
    currency: "USD",
  },
};

export default config;
