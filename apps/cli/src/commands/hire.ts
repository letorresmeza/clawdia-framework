import chalk from "chalk";
import type { Command } from "commander";
import type { IClawBus } from "@clawdia/core";
import type { ContractEngine } from "@clawdia/core";
import type { ServiceRegistry } from "@clawdia/orchestrator";
import type { AgentIdentity } from "@clawdia/types";

// A minimal "operator" identity used as the requester in CLI hire commands
const CLI_IDENTITY: AgentIdentity = {
  name: "clawdia-cli",
  displayName: "Clawdia CLI",
  description: "CLI operator",
  version: "0.1.0",
  operator: "operator",
  publicKey: "cli",
  capabilities: [],
  requirements: [],
  runtime: {},
};

export function registerHireCommand(
  program: Command,
  services: {
    bus: IClawBus;
    registry: ServiceRegistry;
    contracts: ContractEngine;
  },
): void {
  program
    .command("hire <agent-name> <capability>")
    .description(
      "Create a task contract and hire an agent for a specific capability. " +
        "Prints the contract ID. Use --input to pass task data as JSON.",
    )
    .option("--input <json>", "Task input as a JSON string", "{}")
    .option("--amount <price>", "Payment amount", parseFloat)
    .option("--currency <currency>", "Payment currency", "USDC")
    .option("--deadline <ms>", "SLA deadline in milliseconds", parseInt)
    .action(async (
      agentName: string,
      capability: string,
      opts: {
        input: string;
        amount?: number;
        currency: string;
        deadline?: number;
      },
    ) => {
      try {
        // Validate agent exists in registry
        const entry = services.registry.get(agentName);
        if (!entry) {
          const available = services.registry
            .list()
            .map((e) => e.identity.name)
            .join(", ");
          console.error(
            chalk.red("Error:"),
            `Agent "${agentName}" not found in registry.`,
            available ? `\n  Available: ${available}` : "\n  Registry is empty — use `clawdia publish` first.",
          );
          process.exitCode = 1;
          return;
        }

        // Validate capability exists
        const cap = entry.identity.capabilities.find((c) => c.taxonomy === capability);
        if (!cap) {
          console.error(
            chalk.red("Error:"),
            `Agent "${agentName}" does not provide capability "${capability}".`,
            `\n  Available: ${entry.identity.capabilities.map((c) => c.taxonomy).join(", ")}`,
          );
          process.exitCode = 1;
          return;
        }

        // Parse input JSON
        let input: unknown;
        try {
          input = JSON.parse(opts.input);
        } catch {
          console.error(chalk.red("Error:"), "Invalid JSON in --input");
          process.exitCode = 1;
          return;
        }

        const amount = opts.amount ?? cap.pricing.amount;
        const deadlineMs = opts.deadline ?? cap.sla.maxLatencyMs * 10;

        // Create the contract
        const contract = services.contracts.create({
          requester: CLI_IDENTITY,
          provider: entry.identity,
          capability,
          inputSchema: cap.inputSchema,
          outputSchema: cap.outputSchema,
          input,
          payment: { amount, currency: opts.currency },
          sla: { deadlineMs, maxRetries: 1 },
          verification: { method: "schema_match" },
        });

        // Progress through OFFER → ACCEPT → FUND
        await services.contracts.transition(contract.id, "OFFER", CLI_IDENTITY.name);
        await services.contracts.transition(contract.id, "ACCEPT", entry.identity.name);
        await services.contracts.transition(contract.id, "FUND", CLI_IDENTITY.name);

        const funded = services.contracts.get(contract.id)!;

        console.log(chalk.green("Contract created and funded"));
        console.log();
        console.log(`  ${chalk.bold("Contract ID")}  ${chalk.cyan(funded.id)}`);
        console.log(`  ${chalk.bold("State")}        ${chalk.yellow(funded.state)}`);
        console.log(`  ${chalk.bold("Agent")}        ${entry.identity.displayName} ${chalk.dim(`(${entry.identity.name})`)}`);
        console.log(`  ${chalk.bold("Capability")}   ${capability}`);
        console.log(`  ${chalk.bold("Payment")}      ${amount} ${opts.currency}`);
        console.log(`  ${chalk.bold("Deadline")}     ${deadlineMs}ms`);
        console.log(`  ${chalk.bold("Input")}        ${JSON.stringify(input)}`);
        console.log();
        console.log(chalk.dim("The agent will execute and deliver results when online."));
        console.log(chalk.dim(`Use: clawdia status to track progress.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), message);
        process.exitCode = 1;
      }
    });
}
