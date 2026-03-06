import { expect } from "chai";
import { ethers } from "hardhat";
import type { ClawdiaEscrow, MockUSDC } from "../typechain-types";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// 1 USDC = 1e6 units (6 decimals)
const USDC = (n: number) => BigInt(n) * 1_000_000n;
const TIMEOUT = 86_400; // 24 hours

async function deployEscrow(
  usdc: MockUSDC,
  requester: SignerWithAddress,
  provider: SignerWithAddress,
  resolver: SignerWithAddress,
  amount: bigint,
  contractId: string,
  timeoutSeconds: number = TIMEOUT,
) {
  const factory = await ethers.getContractFactory("ClawdiaEscrow");
  const id32 = ethers.encodeBytes32String(contractId.slice(0, 31)); // bytes32 packing
  const escrow = await factory.deploy(
    await usdc.getAddress(),
    requester.address,
    provider.address,
    resolver.address,
    id32,
    amount,
    timeoutSeconds,
  );
  await escrow.waitForDeployment();
  return { escrow: escrow as ClawdiaEscrow, id32 };
}

describe("ClawdiaEscrow", () => {
  let usdc: MockUSDC;
  let owner: SignerWithAddress;
  let requester: SignerWithAddress;
  let provider: SignerWithAddress;
  let resolver: SignerWithAddress;
  let stranger: SignerWithAddress;

  before(async () => {
    [owner, requester, provider, resolver, stranger] = await ethers.getSigners();

    const USDCFactory = await ethers.getContractFactory("MockUSDC");
    usdc = (await USDCFactory.deploy()) as MockUSDC;
    await usdc.waitForDeployment();

    // Mint 1000 USDC to requester
    await usdc.mint(requester.address, USDC(1000));
  });

  // ── Construction ──────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("sets immutables correctly", async () => {
      const amount = USDC(50);
      const { escrow, id32 } = await deployEscrow(
        usdc, requester, provider, resolver, amount, "test-contract-1",
      );

      expect(await escrow.usdc()).to.equal(await usdc.getAddress());
      expect(await escrow.requester()).to.equal(requester.address);
      expect(await escrow.provider()).to.equal(provider.address);
      expect(await escrow.resolver()).to.equal(resolver.address);
      expect(await escrow.contractId()).to.equal(id32);
      expect(await escrow.amount()).to.equal(amount);
      expect(await escrow.timeoutSeconds()).to.equal(TIMEOUT);
      expect(await escrow.getState()).to.equal(0n); // Created
    });

    it("reverts with zero amount", async () => {
      const id32 = ethers.encodeBytes32String("x");
      const EscrowFactory = await ethers.getContractFactory("ClawdiaEscrow");
      const deployTx = EscrowFactory.deploy(
        await usdc.getAddress(),
        requester.address, provider.address, resolver.address,
        id32, 0n, TIMEOUT,
      );
      await expect(deployTx).to.be.revertedWithCustomError(EscrowFactory, "ZeroAmount");
    });
  });

  // ── fund() ────────────────────────────────────────────────────────────────

  describe("fund()", () => {
    let escrow: ClawdiaEscrow;
    let amount: bigint;

    beforeEach(async () => {
      amount = USDC(10);
      ({ escrow } = await deployEscrow(usdc, requester, provider, resolver, amount, "fund-test"));
    });

    it("moves to Funded state and pulls USDC", async () => {
      await usdc.connect(requester).approve(await escrow.getAddress(), amount);

      const balBefore = await usdc.balanceOf(requester.address);
      await expect(escrow.connect(requester).fund())
        .to.emit(escrow, "Funded")
        .withArgs(requester.address, amount, await ethers.provider.getBlock("latest").then((b) => b!.timestamp + 1));

      expect(await escrow.getState()).to.equal(1n); // Funded
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(amount);
      expect(await usdc.balanceOf(requester.address)).to.equal(balBefore - amount);
    });

    it("reverts if non-requester calls fund()", async () => {
      await usdc.connect(requester).approve(await escrow.getAddress(), amount);
      await expect(escrow.connect(stranger).fund()).to.be.revertedWithCustomError(
        escrow, "Unauthorized",
      );
    });

    it("reverts on double-fund", async () => {
      await usdc.connect(requester).approve(await escrow.getAddress(), amount * 2n);
      await escrow.connect(requester).fund();
      await expect(escrow.connect(requester).fund()).to.be.revertedWithCustomError(
        escrow, "WrongState",
      );
    });
  });

  // ── release() ─────────────────────────────────────────────────────────────

  describe("release()", () => {
    let escrow: ClawdiaEscrow;
    let amount: bigint;

    beforeEach(async () => {
      amount = USDC(25);
      ({ escrow } = await deployEscrow(usdc, requester, provider, resolver, amount, "release-test"));
      await usdc.connect(requester).approve(await escrow.getAddress(), amount);
      await escrow.connect(requester).fund();
    });

    it("releases funds to provider", async () => {
      const balBefore = await usdc.balanceOf(provider.address);
      await expect(escrow.connect(requester).release())
        .to.emit(escrow, "Released")
        .withArgs(provider.address, amount);

      expect(await escrow.getState()).to.equal(2n); // Released
      expect(await usdc.balanceOf(provider.address)).to.equal(balBefore + amount);
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("reverts if non-requester calls release()", async () => {
      await expect(escrow.connect(stranger).release()).to.be.revertedWithCustomError(
        escrow, "Unauthorized",
      );
    });
  });

  // ── dispute() ─────────────────────────────────────────────────────────────

  describe("dispute()", () => {
    let escrow: ClawdiaEscrow;
    let amount: bigint;

    beforeEach(async () => {
      amount = USDC(15);
      ({ escrow } = await deployEscrow(usdc, requester, provider, resolver, amount, "dispute-test"));
      await usdc.connect(requester).approve(await escrow.getAddress(), amount);
      await escrow.connect(requester).fund();
    });

    it("requester can open a dispute", async () => {
      await expect(escrow.connect(requester).dispute("provider did not deliver"))
        .to.emit(escrow, "Disputed")
        .withArgs(requester.address, "provider did not deliver");

      expect(await escrow.getState()).to.equal(3n); // Disputed
    });

    it("provider can open a dispute", async () => {
      await expect(escrow.connect(provider).dispute("requester rejected incorrectly"))
        .to.emit(escrow, "Disputed");
    });

    it("stranger cannot open a dispute", async () => {
      await expect(escrow.connect(stranger).dispute("hmm")).to.be.revertedWithCustomError(
        escrow, "Unauthorized",
      );
    });
  });

  // ── claimAfterTimeout() ───────────────────────────────────────────────────

  describe("claimAfterTimeout()", () => {
    let escrow: ClawdiaEscrow;
    let amount: bigint;

    beforeEach(async () => {
      amount = USDC(20);
      ({ escrow } = await deployEscrow(usdc, requester, provider, resolver, amount, "claim-test", 3600));
      await usdc.connect(requester).approve(await escrow.getAddress(), amount);
      await escrow.connect(requester).fund();
      await escrow.connect(requester).dispute("testing timeout claim");
    });

    it("reverts before timeout", async () => {
      await expect(escrow.connect(provider).claimAfterTimeout()).to.be.revertedWithCustomError(
        escrow, "TimeoutNotReached",
      );
    });

    it("provider can claim after timeout", async () => {
      await time.increase(3601);
      const balBefore = await usdc.balanceOf(provider.address);
      await expect(escrow.connect(provider).claimAfterTimeout())
        .to.emit(escrow, "Released")
        .withArgs(provider.address, amount);

      expect(await usdc.balanceOf(provider.address)).to.equal(balBefore + amount);
    });

    it("stranger cannot claim after timeout", async () => {
      await time.increase(3601);
      await expect(escrow.connect(stranger).claimAfterTimeout()).to.be.revertedWithCustomError(
        escrow, "Unauthorized",
      );
    });
  });

  // ── refund() ──────────────────────────────────────────────────────────────

  describe("refund()", () => {
    let escrow: ClawdiaEscrow;
    let amount: bigint;

    beforeEach(async () => {
      amount = USDC(30);
      ({ escrow } = await deployEscrow(usdc, requester, provider, resolver, amount, "refund-test", 3600));
      await usdc.connect(requester).approve(await escrow.getAddress(), amount);
      await escrow.connect(requester).fund();
    });

    it("reverts before timeout", async () => {
      await expect(escrow.connect(requester).refund()).to.be.revertedWithCustomError(
        escrow, "TimeoutNotReached",
      );
    });

    it("requester can refund after timeout (no dispute)", async () => {
      await time.increase(3601);
      const balBefore = await usdc.balanceOf(requester.address);
      await expect(escrow.connect(requester).refund())
        .to.emit(escrow, "Refunded")
        .withArgs(requester.address, amount);

      expect(await usdc.balanceOf(requester.address)).to.equal(balBefore + amount);
    });
  });

  // ── resolve() ─────────────────────────────────────────────────────────────

  describe("resolve()", () => {
    let escrow: ClawdiaEscrow;
    let amount: bigint;

    beforeEach(async () => {
      amount = USDC(40);
      ({ escrow } = await deployEscrow(usdc, requester, provider, resolver, amount, "resolve-test"));
      await usdc.connect(requester).approve(await escrow.getAddress(), amount);
      await escrow.connect(requester).fund();
      await escrow.connect(requester).dispute("need resolution");
    });

    it("resolver splits funds 50/50", async () => {
      const half = amount / 2n;
      const reqBefore = await usdc.balanceOf(requester.address);
      const prvBefore = await usdc.balanceOf(provider.address);

      await expect(escrow.connect(resolver).resolve(half))
        .to.emit(escrow, "Resolved")
        .withArgs(provider.address, half, requester.address, half);

      expect(await usdc.balanceOf(provider.address)).to.equal(prvBefore + half);
      expect(await usdc.balanceOf(requester.address)).to.equal(reqBefore + half);
    });

    it("resolver can award all to provider", async () => {
      await escrow.connect(resolver).resolve(amount);
      expect(await escrow.getState()).to.equal(2n); // Released
    });

    it("resolver can award all to requester", async () => {
      const reqBefore = await usdc.balanceOf(requester.address);
      await escrow.connect(resolver).resolve(0n);
      expect(await usdc.balanceOf(requester.address)).to.equal(reqBefore + amount);
    });

    it("non-resolver cannot resolve", async () => {
      await expect(escrow.connect(stranger).resolve(0n)).to.be.revertedWithCustomError(
        escrow, "Unauthorized",
      );
    });

    it("reverts if providerShare exceeds amount", async () => {
      await expect(escrow.connect(resolver).resolve(amount + 1n)).to.be.revertedWithCustomError(
        escrow, "InvalidSplit",
      );
    });
  });
});
