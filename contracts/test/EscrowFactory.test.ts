import { expect } from "chai";
import { ethers } from "hardhat";
import type { EscrowFactory, ClawdiaEscrow, MockUSDC } from "../typechain-types";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const USDC = (n: number) => BigInt(n) * 1_000_000n;
const DEFAULT_TIMEOUT = 86_400n; // 24 hours

// Convert a Clawdia UUID string to bytes32
function toBytes32(uuid: string): string {
  return ethers.encodeBytes32String(uuid.replace(/-/g, "").slice(0, 31));
}

describe("EscrowFactory", () => {
  let usdc: MockUSDC;
  let factory: EscrowFactory;
  let owner: SignerWithAddress;
  let requester: SignerWithAddress;
  let provider: SignerWithAddress;
  let stranger: SignerWithAddress;

  beforeEach(async () => {
    [owner, requester, provider, stranger] = await ethers.getSigners();

    const USDCFactory = await ethers.getContractFactory("MockUSDC");
    usdc = (await USDCFactory.deploy()) as MockUSDC;
    await usdc.waitForDeployment();

    const FactoryContract = await ethers.getContractFactory("EscrowFactory");
    factory = (await FactoryContract.deploy(
      await usdc.getAddress(),
      DEFAULT_TIMEOUT,
    )) as EscrowFactory;
    await factory.waitForDeployment();

    await usdc.mint(requester.address, USDC(1000));
  });

  // ── Deployment ────────────────────────────────────────────────────────────

  describe("deployment", () => {
    it("sets usdc and timeout correctly", async () => {
      expect(await factory.usdc()).to.equal(await usdc.getAddress());
      expect(await factory.defaultTimeoutSeconds()).to.equal(DEFAULT_TIMEOUT);
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("reverts with zero USDC address", async () => {
      const FactoryContract = await ethers.getContractFactory("EscrowFactory");
      await expect(
        FactoryContract.deploy(ethers.ZeroAddress, DEFAULT_TIMEOUT),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });
  });

  // ── createEscrow() ────────────────────────────────────────────────────────

  describe("createEscrow()", () => {
    const contractId = toBytes32("contract-abc-123");
    const amount = USDC(50);

    it("deploys a ClawdiaEscrow and stores the address", async () => {
      const tx = await factory.createEscrow(contractId, requester.address, provider.address, amount);
      const receipt = await tx.wait();

      // Parse EscrowCreated event
      const iface = factory.interface;
      const log = receipt!.logs.find((l) => {
        try { iface.parseLog(l); return true; } catch { return false; }
      });
      expect(log).to.exist;

      const escrowAddr = await factory.getEscrow(contractId);
      expect(escrowAddr).to.not.equal(ethers.ZeroAddress);
      expect(await factory.escrowExists(contractId)).to.be.true;
    });

    it("emits EscrowCreated with correct args", async () => {
      const tx = await factory.createEscrow(contractId, requester.address, provider.address, amount);
      const receipt = await tx.wait();
      const escrowAddr = await factory.getEscrow(contractId);

      // Parse the event directly and verify fields
      const parsed = factory.interface.parseLog(receipt!.logs[0]!);
      expect(parsed!.name).to.equal("EscrowCreated");
      expect(parsed!.args[0]).to.equal(contractId);
      expect(parsed!.args[1]).to.equal(escrowAddr);
      expect(parsed!.args[2]).to.equal(requester.address);
      expect(parsed!.args[3]).to.equal(provider.address);
      expect(parsed!.args[4]).to.equal(amount);
    });

    it("reverts on duplicate contractId", async () => {
      await factory.createEscrow(contractId, requester.address, provider.address, amount);
      await expect(
        factory.createEscrow(contractId, requester.address, provider.address, amount),
      ).to.be.revertedWithCustomError(factory, "EscrowAlreadyExists");
    });

    it("reverts with zero requester address", async () => {
      await expect(
        factory.createEscrow(contractId, ethers.ZeroAddress, provider.address, amount),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });
  });

  // ── Full happy path through factory ───────────────────────────────────────

  describe("full lifecycle — happy path", () => {
    it("fund → release via factory-created escrow", async () => {
      const contractId = toBytes32("happy-path-001");
      const amount = USDC(100);

      // 1. Create escrow
      await factory.createEscrow(contractId, requester.address, provider.address, amount);
      const escrowAddr = await factory.getEscrow(contractId);

      // Attach typed instance
      const escrow = (await ethers.getContractAt("ClawdiaEscrow", escrowAddr)) as ClawdiaEscrow;

      // 2. Fund
      await usdc.connect(requester).approve(escrowAddr, amount);
      await escrow.connect(requester).fund();
      expect(await escrow.getState()).to.equal(1n); // Funded

      // 3. Release
      const providerBefore = await usdc.balanceOf(provider.address);
      await escrow.connect(requester).release();
      expect(await escrow.getState()).to.equal(2n); // Released
      expect(await usdc.balanceOf(provider.address)).to.equal(providerBefore + amount);
    });
  });

  // ── Dispute → resolution via factory ─────────────────────────────────────

  describe("dispute → resolveDispute()", () => {
    it("owner resolves dispute with 75/25 split", async () => {
      const contractId = toBytes32("dispute-resolution-1");
      const amount = USDC(100);

      await factory.createEscrow(contractId, requester.address, provider.address, amount);
      const escrowAddr = await factory.getEscrow(contractId);
      const escrow = (await ethers.getContractAt("ClawdiaEscrow", escrowAddr)) as ClawdiaEscrow;

      await usdc.connect(requester).approve(escrowAddr, amount);
      await escrow.connect(requester).fund();
      await escrow.connect(requester).dispute("partial delivery");

      const providerShare = USDC(75);
      const requesterBefore = await usdc.balanceOf(requester.address);
      const providerBefore = await usdc.balanceOf(provider.address);

      await factory.connect(owner).resolveDispute(contractId, providerShare);

      expect(await usdc.balanceOf(provider.address)).to.equal(providerBefore + USDC(75));
      expect(await usdc.balanceOf(requester.address)).to.equal(requesterBefore + USDC(25));
    });

    it("non-owner cannot resolve dispute", async () => {
      await expect(
        factory.connect(stranger).resolveDispute(toBytes32("x"), 0n),
      ).to.be.revertedWithCustomError(factory, "Unauthorized");
    });

    it("reverts if escrow does not exist", async () => {
      await expect(
        factory.connect(owner).resolveDispute(toBytes32("nonexistent"), 0n),
      ).to.be.revertedWithCustomError(factory, "EscrowNotFound");
    });
  });

  // ── Custom timeout ────────────────────────────────────────────────────────

  describe("createEscrowWithTimeout()", () => {
    it("creates escrow with custom 1-hour timeout", async () => {
      const contractId = toBytes32("custom-timeout-1");
      const amount = USDC(10);
      const oneHour = 3600n;

      await factory.createEscrowWithTimeout(
        contractId, requester.address, provider.address, amount, oneHour,
      );
      const escrowAddr = await factory.getEscrow(contractId);
      const escrow = (await ethers.getContractAt("ClawdiaEscrow", escrowAddr)) as ClawdiaEscrow;

      expect(await escrow.timeoutSeconds()).to.equal(oneHour);

      // Fund → dispute → claim after 1h
      await usdc.connect(requester).approve(escrowAddr, amount);
      await escrow.connect(requester).fund();
      await escrow.connect(provider).dispute("provider claims requester is wrong");
      await time.increase(3601);

      const before = await usdc.balanceOf(provider.address);
      await escrow.connect(provider).claimAfterTimeout();
      expect(await usdc.balanceOf(provider.address)).to.equal(before + amount);
    });
  });

  // ── Ownership transfer ────────────────────────────────────────────────────

  describe("transferOwnership()", () => {
    it("owner can transfer to new address", async () => {
      await expect(factory.connect(owner).transferOwnership(stranger.address))
        .to.emit(factory, "OwnershipTransferred")
        .withArgs(owner.address, stranger.address);

      expect(await factory.owner()).to.equal(stranger.address);
    });

    it("non-owner cannot transfer", async () => {
      await expect(
        factory.connect(stranger).transferOwnership(stranger.address),
      ).to.be.revertedWithCustomError(factory, "Unauthorized");
    });
  });
});
