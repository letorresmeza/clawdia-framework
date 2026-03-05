import chalk from "chalk";
import type { Command } from "commander";
import type { ServiceRegistry } from "@clawdia/orchestrator";
import type { ReputationEngine } from "@clawdia/economy";

export function registerSearchCommand(
  program: Command,
  services: {
    registry: ServiceRegistry;
    reputation?: ReputationEngine;
  },
): void {
  program
    .command("search <query>")
    .description(
      "Search the registry for agents by capability taxonomy, price, or reputation. " +
      "Supports * wildcard at end of taxonomy (e.g. \"analysis.*\").",
    )
    .option("--max-price <amount>", "Maximum price per request", parseFloat)
    .option("--currency <currency>", "Currency filter (e.g. USDC)")
    .option("--min-rep <score>", "Minimum reputation score (0.0 – 1.0)", parseFloat)
    .option("--limit <n>", "Maximum results to return", parseInt)
    .option("--offline", "Include offline agents")
    .action((
      query: string,
      opts: {
        maxPrice?: number;
        currency?: string;
        minRep?: number;
        limit?: number;
        offline?: boolean;
      },
    ) => {
      try {
        const result = services.registry.discover({
          taxonomy: query,
          maxPrice: opts.maxPrice,
          currency: opts.currency,
          minReputation: opts.minRep,
          limit: opts.limit,
          onlineOnly: !opts.offline,
        });

        if (result.total === 0) {
          console.log(chalk.dim(`No agents found for "${query}"`));
          if (opts.maxPrice !== undefined) {
            console.log(chalk.dim(`  (price filter: ≤ ${opts.maxPrice} ${opts.currency ?? "any"})`));
          }
          return;
        }

        const shown = result.entries.length;
        const totalLabel =
          result.total > shown
            ? `${shown} of ${result.total} total`
            : `${result.total}`;

        console.log(chalk.bold(`Found ${totalLabel} agent(s) matching "${query}"`));
        console.log();

        for (const entry of result.entries) {
          const id = entry.identity;

          // Status indicator
          const statusColor =
            entry.status === "online"
              ? chalk.green("●")
              : entry.status === "busy"
                ? chalk.yellow("●")
                : chalk.red("●");

          console.log(
            `${statusColor} ${chalk.bold(id.displayName)} ${chalk.dim(`(${id.name} v${id.version})`)}`,
          );
          console.log(`  Operator: ${id.operator}`);

          // Reputation from engine if available
          if (services.reputation) {
            const rep = services.reputation.getRecord(id.name);
            if (rep) {
              const score = Math.round(rep.overallScore * 100);
              const bar = "█".repeat(Math.round(rep.overallScore * 10)) + "░".repeat(10 - Math.round(rep.overallScore * 10));
              console.log(
                `  Reputation: ${bar} ${score}% (${rep.contractsCompleted} completed · ${rep.contractsFailed} failed)`,
              );
            }
          } else if (id.reputation) {
            console.log(`  Reputation: ${Math.round(id.reputation.score * 100)}%`);
          }

          // Matching capabilities
          const matchingCaps = id.capabilities.filter((c) => {
            if (query.endsWith("*")) return c.taxonomy.startsWith(query.slice(0, -1));
            return c.taxonomy === query;
          });

          const allCaps = matchingCaps.length > 0 ? matchingCaps : id.capabilities;
          for (const cap of allCaps) {
            const isMatch = matchingCaps.includes(cap);
            const label = isMatch ? chalk.cyan(cap.taxonomy) : chalk.dim(cap.taxonomy);
            console.log(
              `  ${label}  ${chalk.yellow(`${cap.pricing.amount} ${cap.pricing.currency}`)}/${cap.pricing.model}  ${chalk.dim(`${cap.sla.maxLatencyMs}ms`)}`,
            );
            if (isMatch) console.log(`    ${chalk.dim(cap.description)}`);
          }

          console.log();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red("Error:"), message);
        process.exitCode = 1;
      }
    });
}
