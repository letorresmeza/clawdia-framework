import { ethers, network } from "hardhat";

/**
 * Deploy EscrowFactory to the configured network.
 *
 * Environment variables:
 *   USDC_ADDRESS          - USDC token address (required for non-local networks)
 *   DISPUTE_TIMEOUT_HOURS - default dispute timeout in hours (default: 24)
 *   MIN_STAKE_USDC        - minimum registry stake in USDC (default: 10)
 *   UNSTAKE_COOLDOWN_HOURS - registry unstake cooldown in hours (default: 24)
 *
 * Usage:
 *   pnpm deploy:local       (deploys MockUSDC + Factory on localhost)
 *   pnpm deploy:baseSepolia (requires USDC_ADDRESS + DEPLOYER_PRIVATE_KEY in env)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const isLocal = network.name === "hardhat" || network.name === "localhost";

  console.log(`\nDeploying to: ${network.name}`);
  console.log(`Deployer:     ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:      ${ethers.formatEther(balance)} ETH\n`);

  // ── 1. USDC ───────────────────────────────────────────────────────────────

  let usdcAddress: string;

  if (isLocal) {
    console.log("Deploying MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();
    usdcAddress = await usdc.getAddress();
    console.log(`  MockUSDC:    ${usdcAddress}`);
  } else {
    usdcAddress = process.env["USDC_ADDRESS"] ?? "";
    if (!usdcAddress) {
      throw new Error("Set USDC_ADDRESS env var for non-local deployments");
    }
    // Base Sepolia USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
    console.log(`  Using USDC:  ${usdcAddress}`);
  }

  // ── 2. EscrowFactory ─────────────────────────────────────────────────────

  const timeoutHours = parseInt(process.env["DISPUTE_TIMEOUT_HOURS"] ?? "24", 10);
  const timeoutSeconds = timeoutHours * 3600;
  console.log(`\nDeploying EscrowFactory (timeout: ${timeoutHours}h)...`);

  const Factory = await ethers.getContractFactory("EscrowFactory");
  const factory = await Factory.deploy(usdcAddress, timeoutSeconds);
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  console.log(`  EscrowFactory: ${factoryAddress}`);

  // ── 3. AgentRegistry ──────────────────────────────────────────────────────

  const minStakeUsdc = parseFloat(process.env["MIN_STAKE_USDC"] ?? "10");
  const minStakeUnits = BigInt(Math.round(minStakeUsdc * 1_000_000));
  const unstakeCooldownHours = parseInt(process.env["UNSTAKE_COOLDOWN_HOURS"] ?? "24", 10);
  const unstakeCooldownSeconds = unstakeCooldownHours * 3600;
  console.log(
    `\nDeploying AgentRegistry (minimum stake: ${minStakeUsdc} USDC, cooldown: ${unstakeCooldownHours}h)...`,
  );

  const Registry = await ethers.getContractFactory("AgentRegistry");
  const registry = await Registry.deploy(usdcAddress, minStakeUnits, unstakeCooldownSeconds);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`  AgentRegistry: ${registryAddress}`);

  // ── 4. Output deployment info ─────────────────────────────────────────────

  const deploymentInfo = {
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    usdc: usdcAddress,
    escrowFactory: factoryAddress,
    agentRegistry: registryAddress,
    defaultTimeoutSeconds: timeoutSeconds,
    minimumStakeUnits: minStakeUnits.toString(),
    unstakeCooldownSeconds,
    deployedAt: new Date().toISOString(),
  };

  console.log("\nDeployment complete:");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  // Write to deployment file for plugin to read
  const fs = await import("fs");
  const outPath = `./deployments/${network.name}.json`;
  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\nSaved to ${outPath}`);

  return deploymentInfo;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
