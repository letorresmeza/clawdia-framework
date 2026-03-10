import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { AgentRegistry, MockUSDC } from "../typechain-types";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

const USDC = (n: number) => BigInt(n) * 1_000_000n;
const COOLDOWN = 86_400n;

function toAgentId(name: string): string {
  return ethers.encodeBytes32String(name.slice(0, 31));
}

describe("AgentRegistry", () => {
  let usdc: MockUSDC;
  let registry: AgentRegistry;
  let owner: SignerWithAddress;
  let operator: SignerWithAddress;
  let payoutWallet: SignerWithAddress;
  let recipient: SignerWithAddress;

  beforeEach(async () => {
    [owner, operator, payoutWallet, recipient] = await ethers.getSigners();

    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    usdc = (await MockUSDCFactory.deploy()) as MockUSDC;
    await usdc.waitForDeployment();

    const RegistryFactory = await ethers.getContractFactory("AgentRegistry");
    registry = (await RegistryFactory.deploy(
      await usdc.getAddress(),
      USDC(10),
      COOLDOWN,
    )) as AgentRegistry;
    await registry.waitForDeployment();

    await usdc.mint(operator.address, USDC(1000));
  });

  it("registers an agent with initial stake", async () => {
    const agentId = toAgentId("research-agent");
    await usdc.connect(operator).approve(await registry.getAddress(), USDC(25));

    await expect(
      registry
        .connect(operator)
        .registerAgent(agentId, payoutWallet.address, "ipfs://research-agent", USDC(25)),
    )
      .to.emit(registry, "AgentRegistered")
      .withArgs(agentId, payoutWallet.address, USDC(25), "ipfs://research-agent");

    const record = await registry.getAgent(agentId);
    expect(record.stake).to.equal(USDC(25));
    expect(record.metadataURI).to.equal("ipfs://research-agent");
    expect(await registry.isEligible(agentId)).to.equal(true);
  });

  it("rejects registration below minimum stake", async () => {
    const agentId = toAgentId("underfunded-agent");
    await usdc.connect(operator).approve(await registry.getAddress(), USDC(5));

    await expect(
      registry.connect(operator).registerAgent(agentId, payoutWallet.address, "ipfs://agent", USDC(5)),
    ).to.be.revertedWithCustomError(registry, "MinimumStakeNotMet");
  });

  it("adds stake and tracks the updated balance", async () => {
    const agentId = toAgentId("staking-agent");
    await usdc.connect(operator).approve(await registry.getAddress(), USDC(40));
    await registry
      .connect(operator)
      .registerAgent(agentId, payoutWallet.address, "ipfs://staking-agent", USDC(20));

    await expect(registry.connect(operator).addStake(agentId, USDC(15)))
      .to.emit(registry, "StakeAdded")
      .withArgs(agentId, USDC(15), USDC(35));
  });

  it("supports unstake cooldown and withdrawal", async () => {
    const agentId = toAgentId("cooldown-agent");
    await usdc.connect(operator).approve(await registry.getAddress(), USDC(20));
    await registry
      .connect(operator)
      .registerAgent(agentId, payoutWallet.address, "ipfs://cooldown-agent", USDC(20));

    await expect(registry.connect(owner).requestUnstake(agentId, USDC(10)))
      .to.emit(registry, "UnstakeRequested");

    await expect(registry.connect(owner).withdrawStake(agentId)).to.be.revertedWithCustomError(
      registry,
      "CooldownNotReached",
    );

    await time.increase(Number(COOLDOWN) + 1);
    await expect(registry.connect(owner).withdrawStake(agentId))
      .to.emit(registry, "StakeWithdrawn")
      .withArgs(agentId, USDC(10));
  });

  it("slashes agent stake to a recipient", async () => {
    const agentId = toAgentId("slashable-agent");
    await usdc.connect(operator).approve(await registry.getAddress(), USDC(30));
    await registry
      .connect(operator)
      .registerAgent(agentId, payoutWallet.address, "ipfs://slashable-agent", USDC(30));

    const before = await usdc.balanceOf(recipient.address);
    await expect(registry.connect(owner).slash(agentId, USDC(12), recipient.address))
      .to.emit(registry, "StakeSlashed")
      .withArgs(agentId, USDC(12), recipient.address);

    const after = await usdc.balanceOf(recipient.address);
    expect(after - before).to.equal(USDC(12));
    expect((await registry.getAgent(agentId)).stake).to.equal(USDC(18));
  });
});
