import chalk from "chalk";
import type { Command } from "commander";
import type { ServiceRegistry } from "@clawdia/orchestrator";

export function registerRegistryCommand(
  program: Command,
  services: {
    registry: ServiceRegistry;
  },
): void {
  const reg = program
    .command("registry")
    .description("Manage the agent service registry");

  reg
    .command("list")
    .description("List all registered agents")
    .action(() => {
      const entries = services.registry.list();
      if (entries.length === 0) {
        console.log(chalk.dim("No agents registered"));
        return;
      }

      console.log(chalk.bold("Registered Agents"));
      for (const entry of entries) {
        const caps = entry.identity.capabilities.map((c) => c.taxonomy).join(", ");
        console.log(
          `  ${entry.identity.name.padEnd(20)}  ${formatStatus(entry.status)}  ${chalk.dim(caps)}`,
        );
      }

      const stats = services.registry.stats();
      console.log();
      console.log(
        chalk.dim(`Total: ${entries.length}  Online: ${stats["online"] ?? 0}  Offline: ${stats["offline"] ?? 0}  Busy: ${stats["busy"] ?? 0}`),
      );
    });

  reg
    .command("discover <taxonomy>")
    .description("Discover agents matching a capability taxonomy (supports * wildcard)")
    .option("--max-price <amount>", "Maximum price per request", parseFloat)
    .option("--currency <currency>", "Currency filter")
    .action((taxonomy: string, opts: { maxPrice?: number; currency?: string }) => {
      const result = services.registry.discover({
        taxonomy,
        maxPrice: opts.maxPrice,
        currency: opts.currency,
      });

      if (result.entries.length === 0) {
        console.log(chalk.dim("No agents found matching criteria"));
        return;
      }

      console.log(chalk.bold(`Found ${result.total} agent(s)`));
      for (const entry of result.entries) {
        const matchingCaps = entry.identity.capabilities
          .filter((c) => {
            if (taxonomy.endsWith("*")) {
              return c.taxonomy.startsWith(taxonomy.slice(0, -1));
            }
            return c.taxonomy === taxonomy;
          });

        console.log(`  ${chalk.cyan(entry.identity.name)} ${chalk.dim(`v${entry.identity.version}`)}`);
        for (const cap of matchingCaps) {
          console.log(`    ${cap.taxonomy}  ${cap.pricing.amount} ${cap.pricing.currency}/${cap.pricing.model}`);
        }
      }
    });

  reg
    .command("info <agent-name>")
    .description("Show detailed info for an agent")
    .action((agentName: string) => {
      const entry = services.registry.get(agentName);
      if (!entry) {
        console.error(chalk.red("Error:"), `Agent "${agentName}" not found in registry`);
        process.exitCode = 1;
        return;
      }

      const id = entry.identity;
      console.log(chalk.bold(id.displayName), chalk.dim(`(${id.name} v${id.version})`));
      console.log(`  Operator:     ${id.operator}`);
      console.log(`  Status:       ${formatStatus(entry.status)}`);
      console.log(`  Registered:   ${entry.registeredAt}`);
      console.log(`  Last Seen:    ${entry.lastSeen}`);
      if (entry.sessionId) {
        console.log(`  Session:      ${chalk.cyan(entry.sessionId)}`);
      }
      console.log(`  Public Key:   ${chalk.dim(id.publicKey)}`);

      console.log();
      console.log(chalk.bold("  Capabilities"));
      for (const cap of id.capabilities) {
        console.log(`    ${cap.taxonomy}`);
        console.log(`      ${cap.description}`);
        console.log(`      SLA: ${cap.sla.maxLatencyMs}ms latency, ${(cap.sla.availability * 100).toFixed(1)}% availability`);
        console.log(`      Price: ${cap.pricing.amount} ${cap.pricing.currency} (${cap.pricing.model})`);
      }

      if (id.requirements.length > 0) {
        console.log();
        console.log(chalk.bold("  Requirements"));
        for (const req of id.requirements) {
          const opt = req.optional ? chalk.dim(" (optional)") : "";
          console.log(`    ${req.taxonomy}${opt}`);
        }
      }

      if (id.runtime.model) {
        console.log();
        console.log(chalk.bold("  Runtime"));
        console.log(`    Model:   ${id.runtime.model}`);
        if (id.runtime.image) console.log(`    Image:   ${id.runtime.image}`);
        if (id.runtime.memoryMb) console.log(`    Memory:  ${id.runtime.memoryMb} MB`);
        if (id.runtime.cpus) console.log(`    CPUs:    ${id.runtime.cpus}`);
      }
    });

  reg
    .command("deregister <agent-name>")
    .description("Remove an agent from the registry")
    .action((agentName: string) => {
      const removed = services.registry.deregister(agentName);
      if (removed) {
        console.log(chalk.green("Deregistered:"), agentName);
      } else {
        console.error(chalk.red("Error:"), `Agent "${agentName}" not found in registry`);
        process.exitCode = 1;
      }
    });
}

function formatStatus(status: "online" | "offline" | "busy"): string {
  switch (status) {
    case "online":
      return chalk.green(status);
    case "offline":
      return chalk.red(status);
    case "busy":
      return chalk.yellow(status);
  }
}
