import chalk from "chalk";
import type { Command } from "commander";
import { WalletStore, maskPrivateKey } from "../wallet-store.js";

export function registerWalletCommand(program: Command): void {
  const wallet = program.command("wallet").description("Manage agent wallets for EVM settlement");
  const store = new WalletStore();

  wallet
    .command("list")
    .description("List all local wallets")
    .action(() => {
      const wallets = store.list();
      const defaultWallet = store.getDefault();
      if (wallets.length === 0) {
        console.log(chalk.dim(`No wallets found in ${store.getPath()}`));
        return;
      }

      console.log(chalk.bold("Wallets"));
      for (const entry of wallets) {
        const defaultMarker = defaultWallet?.name === entry.name ? chalk.green("default") : "";
        console.log(`  ${chalk.cyan(entry.name)}  ${entry.address} ${defaultMarker}`.trimEnd());
      }
      console.log();
      console.log(chalk.dim(store.getPath()));
    });

  wallet
    .command("create <name>")
    .description("Create a new local wallet")
    .option("--default", "Set this wallet as the default wallet")
    .action((name: string, opts: { default?: boolean }) => {
      const created = store.create(name, opts.default);
      console.log(chalk.green("Wallet created"));
      console.log(`  ${chalk.bold("Name")}       ${created.name}`);
      console.log(`  ${chalk.bold("Address")}    ${created.address}`);
      console.log(`  ${chalk.bold("PrivateKey")} ${maskPrivateKey(created.privateKey)}`);
    });

  wallet
    .command("show <name>")
    .description("Show details for a local wallet")
    .option("--private-key", "Show the full private key")
    .action((name: string, opts: { privateKey?: boolean }) => {
      const entry = store.get(name);
      if (!entry) {
        console.error(chalk.red("Error:"), `Wallet "${name}" not found`);
        process.exitCode = 1;
        return;
      }

      console.log(chalk.bold(entry.name));
      console.log(`  Address:     ${entry.address}`);
      console.log(`  Created:     ${entry.createdAt}`);
      console.log(
        `  Private Key: ${opts.privateKey ? entry.privateKey : maskPrivateKey(entry.privateKey)}`,
      );
    });

  wallet
    .command("import <name>")
    .description("Import a wallet from a private key")
    .requiredOption("--private-key <hex>", "Hex-encoded private key")
    .option("--default", "Set this wallet as the default wallet")
    .action((name: string, opts: { privateKey: string; default?: boolean }) => {
      const entry = store.importFromPrivateKey(name, opts.privateKey, opts.default);
      console.log(chalk.green("Wallet imported"));
      console.log(`  ${chalk.bold("Name")}    ${entry.name}`);
      console.log(`  ${chalk.bold("Address")} ${entry.address}`);
    });

  wallet
    .command("export <name>")
    .description("Export a wallet private key")
    .action((name: string) => {
      const entry = store.get(name);
      if (!entry) {
        console.error(chalk.red("Error:"), `Wallet "${name}" not found`);
        process.exitCode = 1;
        return;
      }

      console.log(entry.privateKey);
    });

  wallet
    .command("default <name>")
    .description("Set the default wallet")
    .action((name: string) => {
      try {
        store.setDefault(name);
        console.log(chalk.green("Default wallet set:"), name);
      } catch (err) {
        console.error(chalk.red("Error:"), err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  wallet
    .command("delete <name>")
    .description("Delete a wallet from local storage")
    .action((name: string) => {
      const removed = store.remove(name);
      if (!removed) {
        console.error(chalk.red("Error:"), `Wallet "${name}" not found`);
        process.exitCode = 1;
        return;
      }
      console.log(chalk.green("Deleted wallet:"), name);
    });
}
