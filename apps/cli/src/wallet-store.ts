import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Wallet } from "ethers";

export interface WalletRecord {
  name: string;
  address: string;
  privateKey: string;
  createdAt: string;
}

interface WalletStoreData {
  defaultWallet?: string;
  wallets: WalletRecord[];
}

const DEFAULT_DATA: WalletStoreData = {
  wallets: [],
};

export class WalletStore {
  constructor(private readonly storePath = resolveWalletStorePath()) {}

  list(): WalletRecord[] {
    return this.read().wallets;
  }

  get(name: string): WalletRecord | undefined {
    return this.read().wallets.find((wallet) => wallet.name === name);
  }

  getDefault(): WalletRecord | undefined {
    const data = this.read();
    if (!data.defaultWallet) return undefined;
    return data.wallets.find((wallet) => wallet.name === data.defaultWallet);
  }

  create(name: string, setDefault = false): WalletRecord {
    const data = this.read();
    this.ensureUniqueName(data, name);

    const wallet = Wallet.createRandom();
    const record: WalletRecord = {
      name,
      address: wallet.address,
      privateKey: wallet.privateKey,
      createdAt: new Date().toISOString(),
    };
    data.wallets.push(record);
    if (setDefault || data.wallets.length === 1) {
      data.defaultWallet = name;
    }
    this.write(data);
    return record;
  }

  importFromPrivateKey(name: string, privateKey: string, setDefault = false): WalletRecord {
    const data = this.read();
    this.ensureUniqueName(data, name);

    const wallet = new Wallet(privateKey);
    const record: WalletRecord = {
      name,
      address: wallet.address,
      privateKey: wallet.privateKey,
      createdAt: new Date().toISOString(),
    };
    data.wallets.push(record);
    if (setDefault || data.wallets.length === 1) {
      data.defaultWallet = name;
    }
    this.write(data);
    return record;
  }

  remove(name: string): boolean {
    const data = this.read();
    const nextWallets = data.wallets.filter((wallet) => wallet.name !== name);
    if (nextWallets.length === data.wallets.length) {
      return false;
    }

    data.wallets = nextWallets;
    if (data.defaultWallet === name) {
      data.defaultWallet = nextWallets[0]?.name;
    }
    this.write(data);
    return true;
  }

  setDefault(name: string): void {
    const data = this.read();
    if (!data.wallets.some((wallet) => wallet.name === name)) {
      throw new Error(`Wallet "${name}" not found`);
    }
    data.defaultWallet = name;
    this.write(data);
  }

  getPath(): string {
    return this.storePath;
  }

  private read(): WalletStoreData {
    ensureParentDir(this.storePath);
    if (!existsSync(this.storePath)) {
      this.write(DEFAULT_DATA);
      return { ...DEFAULT_DATA, wallets: [] };
    }

    const raw = JSON.parse(readFileSync(this.storePath, "utf-8")) as WalletStoreData;
    return {
      defaultWallet: raw.defaultWallet,
      wallets: raw.wallets ?? [],
    };
  }

  private write(data: WalletStoreData): void {
    ensureParentDir(this.storePath);
    writeFileSync(this.storePath, JSON.stringify(data, null, 2));
  }

  private ensureUniqueName(data: WalletStoreData, name: string): void {
    if (data.wallets.some((wallet) => wallet.name === name)) {
      throw new Error(`Wallet "${name}" already exists`);
    }
  }
}

function resolveWalletStorePath(): string {
  const walletHome = process.env["CLAWDIA_WALLET_HOME"] ?? join(homedir(), ".clawdia");
  return join(walletHome, "wallets.json");
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function maskPrivateKey(privateKey: string): string {
  return `${privateKey.slice(0, 10)}...${privateKey.slice(-6)}`;
}
