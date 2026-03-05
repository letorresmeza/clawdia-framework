import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import type { IdentityRuntime } from "@clawdia/core";
import type { ServiceRegistry } from "@clawdia/orchestrator";

export function registerPublishCommand(
  program: Command,
  services: {
    identityRuntime: IdentityRuntime;
    registry: ServiceRegistry;
  },
): void {
  program
    .command("publish <soul-file>")
    .description(
      "Validate a soul.md manifest and publish the agent to the registry (no container spawned)",
    )
    .option("--dry-run", "Validate only — do not register")
    .action(async (soulFile: string, opts: { dryRun?: boolean }) => {
      try {
        const fullPath = resolve(soulFile);
        const content = readFileSync(fullPath, "utf-8");

        // Parse and validate
        const identity = await services.identityRuntime.register(content);

        if (opts.dryRun) {
          console.log(chalk.bold("Validation passed (dry run — not registered)"));
        } else {
          services.registry.register(identity);
          console.log(chalk.green("Published:"), identity.displayName, chalk.dim(`(${identity.name})`));
        }

        console.log();
        console.log(`  ${chalk.bold("Name")}         ${identity.name}`);
        console.log(`  ${chalk.bold("Display")}      ${identity.displayName}`);
        console.log(`  ${chalk.bold("Version")}      ${identity.version}`);
        console.log(`  ${chalk.bold("Operator")}     ${identity.operator}`);
        console.log(`  ${chalk.bold("Public Key")}   ${chalk.dim(identity.publicKey.slice(0, 32))}…`);

        if (identity.capabilities.length > 0) {
          console.log();
          console.log(chalk.bold("  Capabilities"));
          for (const cap of identity.capabilities) {
            console.log(`    ${chalk.cyan(cap.taxonomy)}`);
            console.log(`      ${chalk.dim(cap.description)}`);
            console.log(
              `      SLA: ${cap.sla.maxLatencyMs}ms latency · ${(cap.sla.availability * 100).toFixed(1)}% availability`,
            );
            console.log(
              `      Price: ${chalk.yellow(`${cap.pricing.amount} ${cap.pricing.currency}`)} / ${cap.pricing.model}`,
            );
          }
        }

        if (identity.requirements.length > 0) {
          console.log();
          console.log(chalk.bold("  Requires"));
          for (const req of identity.requirements) {
            const opt = req.optional ? chalk.dim(" (optional)") : "";
            console.log(`    ${req.taxonomy}${opt}`);
          }
        }

        if (identity.runtime.model) {
          console.log();
          console.log(chalk.bold("  Runtime"));
          console.log(`    Model: ${identity.runtime.model}`);
          if (identity.runtime.memoryMb) console.log(`    Memory: ${identity.runtime.memoryMb} MB`);
          if (identity.runtime.cpus) console.log(`    CPUs: ${identity.runtime.cpus}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), message);
        process.exitCode = 1;
      }
    });
}
