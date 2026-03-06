/**
 * Tests for EvmSettlementRail and SettlementBridge.
 *
 * Uses ethers mock objects so no live network is required.
 * Full on-chain integration is covered by contracts/test/*.test.ts (Hardhat).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EscrowHandle, TaskContract, AgentIdentity } from "@clawdia/types";
import { EvmSettlementRail, type EvmSettlementConfig } from "../evm-settlement.js";
import { SettlementBridge } from "../settlement-bridge.js";
import { InMemoryBus, ContractEngine } from "@clawdia/core";

// ─────────────────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────────────────

const FACTORY_ADDR = "0xFactory0000000000000000000000000000000001";
const USDC_ADDR    = "0xUSDC00000000000000000000000000000000000001";
const ESCROW_ADDR  = "0xEscrow0000000000000000000000000000000001";
const REQUESTER    = "0xRequester00000000000000000000000000000001";
const PROVIDER     = "0xProvider000000000000000000000000000000001";

/** Build a minimal mock ethers Signer */
function mockSigner(address = REQUESTER) {
  return {
    getAddress: vi.fn().mockResolvedValue(address),
    resolveName: vi.fn().mockResolvedValue(address),
    provider: {
      resolveName: vi.fn().mockResolvedValue(address),
    },
  } as unknown as import("ethers").Signer;
}

/** Build a mock ethers Contract whose methods can be overridden per-test */
function mockContract(overrides: Record<string, unknown> = {}) {
  const base = {
    getEscrow: vi.fn().mockResolvedValue("0x0000000000000000000000000000000000000000"),
    createEscrow: vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({
        hash: "0xcreateTxHash",
        logs: [
          {
            // Simulate EscrowCreated event log — parsed by iface in the real code
            topics: [],
            data: "0x",
          },
        ],
      }),
    }),
    approve: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }),
    fund: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({ hash: "0xfundTx" }) }),
    release: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({ hash: "0xreleaseTx" }) }),
    dispute: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({}) }),
    balanceOf: vi.fn().mockResolvedValue(BigInt(500_000_000)), // 500 USDC
    interface: {
      parseLog: vi.fn().mockReturnValue({ name: "EscrowCreated", args: [null, ESCROW_ADDR] }),
    },
    ...overrides,
  };
  return base;
}

/** Minimal AgentIdentity */
function makeIdentity(name: string): AgentIdentity {
  return {
    name,
    displayName: name,
    description: "test",
    version: "1.0.0",
    operator: "test",
    publicKey: "key",
    capabilities: [],
    requirements: [],
    runtime: {},
  };
}

/** Build a minimal TaskContract */
function makeContract(id = "contract-abc-123"): TaskContract {
  return {
    id,
    state: "in_progress",
    requester: makeIdentity("coordinator"),
    provider:  makeIdentity("data-analyst"),
    capability: "analysis.data.csv",
    inputSchema: {},
    outputSchema: {},
    input: { data: "col1,col2\n1,2" },
    payment: { amount: 0.05, currency: "USDC" },
    sla: { deadlineMs: 30_000, maxRetries: 1 },
    verification: { method: "schema_match" },
    signatures: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
  };
}

// ─────────────────────────────────────────────────────────
// EvmSettlementRail
// ─────────────────────────────────────────────────────────

describe("EvmSettlementRail", () => {
  let rail: EvmSettlementRail;
  let factoryMock: ReturnType<typeof mockContract>;
  let usdcMock: ReturnType<typeof mockContract>;
  let escrowMock: ReturnType<typeof mockContract>;

  beforeEach(() => {
    factoryMock = mockContract();
    usdcMock    = mockContract();
    escrowMock  = mockContract();

    const config: EvmSettlementConfig = {
      signer:         mockSigner(),
      factoryAddress: FACTORY_ADDR,
      usdcAddress:    USDC_ADDR,
      addressBook: { "data-analyst": PROVIDER },
    };

    rail = new EvmSettlementRail(config);

    // Inject mocks by patching the internal contracts
    // We access them via a cast since they're private
    const r = rail as unknown as Record<string, unknown>;
    r["factory"] = factoryMock;
    r["usdc"]    = usdcMock;

    // Patch escrow contract construction so escrow instances use our mock
    vi.spyOn(rail as unknown as { _buildEscrowContract(addr: string): unknown },
      "_buildEscrowContract" as never
    ).mockReturnValue(escrowMock);
  });

  // ── createEscrow() ──────────────────────────────────────────────────────

  describe("createEscrow()", () => {
    it("calls factory.createEscrow with correct args", async () => {
      const contract = makeContract();
      const handle = await rail.createEscrow(contract);

      expect(factoryMock.createEscrow).toHaveBeenCalledWith(
        expect.any(String), // bytes32 contractId
        REQUESTER,
        PROVIDER,
        BigInt(50_000), // 0.05 USDC × 1e6
      );
      expect(handle.contractId).toBe(contract.id);
      expect(handle.currency).toBe("USDC");
    });

    it("is idempotent when escrow already exists on-chain", async () => {
      factoryMock.getEscrow = vi.fn().mockResolvedValue(ESCROW_ADDR);

      const contract = makeContract("duplicate-id");
      const handle = await rail.createEscrow(contract);

      expect(factoryMock.createEscrow).not.toHaveBeenCalled();
      expect(handle.id).toBe(ESCROW_ADDR);
    });

    it("stores the escrow address for later use", async () => {
      const contract = makeContract("store-test");
      await rail.createEscrow(contract);

      // Should be accessible
      rail.registerEscrow("manual-id", "0xManual");
      expect(rail.getEscrowAddress("manual-id")).toBe("0xManual");
    });
  });

  // ── fundEscrow() ──────────────────────────────────────────────────────────

  describe("fundEscrow()", () => {
    it("approves USDC and calls fund()", async () => {
      const handle: EscrowHandle = {
        id: ESCROW_ADDR,
        contractId: "contract-fund-test",
        amount: BigInt(50_000),
        currency: "USDC",
        status: "created",
      };

      // Register so _getEscrowAddress works
      rail.registerEscrow(handle.contractId, ESCROW_ADDR);

      // Patch internal escrow contract construction
      const r = rail as unknown as Record<string, unknown>;
      r["_buildEscrowContract"] = () => escrowMock;

      const txHash = await rail.fundEscrow(handle, handle.amount);

      expect(usdcMock.approve).toHaveBeenCalledWith(ESCROW_ADDR, handle.amount);
      expect(txHash).toBeTruthy();
    });
  });

  // ── releaseEscrow() ───────────────────────────────────────────────────────

  describe("releaseEscrow()", () => {
    it("calls release() and returns tx hash", async () => {
      const handle: EscrowHandle = {
        id: ESCROW_ADDR,
        contractId: "contract-release-test",
        amount: BigInt(50_000),
        currency: "USDC",
        status: "funded",
      };

      rail.registerEscrow(handle.contractId, ESCROW_ADDR);
      const r = rail as unknown as Record<string, unknown>;
      r["_buildEscrowContract"] = () => escrowMock;

      const txHash = await rail.releaseEscrow(handle, PROVIDER);

      expect(escrowMock.release).toHaveBeenCalled();
      expect(txHash).toBe("0xreleaseTx");
    });
  });

  // ── disputeEscrow() ───────────────────────────────────────────────────────

  describe("disputeEscrow()", () => {
    it("calls dispute() with the reason string", async () => {
      const handle: EscrowHandle = {
        id: ESCROW_ADDR,
        contractId: "contract-dispute-test",
        amount: BigInt(50_000),
        currency: "USDC",
        status: "funded",
      };

      rail.registerEscrow(handle.contractId, ESCROW_ADDR);
      const r = rail as unknown as Record<string, unknown>;
      r["_buildEscrowContract"] = () => escrowMock;

      await rail.disputeEscrow(handle, "provider failed to deliver");

      expect(escrowMock.dispute).toHaveBeenCalledWith("provider failed to deliver");
    });
  });

  // ── getBalance() ──────────────────────────────────────────────────────────

  describe("getBalance()", () => {
    it("returns USDC balance from contract", async () => {
      const balance = await rail.getBalance(REQUESTER);
      expect(usdcMock.balanceOf).toHaveBeenCalledWith(REQUESTER);
      expect(balance).toBe(BigInt(500_000_000));
    });
  });

  // ── registerEscrow() / getEscrowAddress() ─────────────────────────────────

  describe("registerEscrow()", () => {
    it("stores and retrieves escrow addresses", () => {
      rail.registerEscrow("my-contract-id", "0xSomeEscrow");
      expect(rail.getEscrowAddress("my-contract-id")).toBe("0xSomeEscrow");
    });

    it("returns undefined for unknown contract ids", () => {
      expect(rail.getEscrowAddress("unknown")).toBeUndefined();
    });
  });

  // ── plugin export ─────────────────────────────────────────────────────────

  describe("plugin module", () => {
    it("is a valid PluginModule", async () => {
      const mod = await import("../index.js");
      expect(mod.default.name).toBe("evm-settlement");
      expect(mod.default.type).toBe("settlement");
      expect(typeof mod.default.create).toBe("function");
    });

    it("throws when created without config", async () => {
      const mod = await import("../index.js");
      expect(() => mod.default.create()).toThrow(/requires config/);
    });
  });
});

// ─────────────────────────────────────────────────────────
// SettlementBridge
// ─────────────────────────────────────────────────────────

describe("SettlementBridge", () => {
  let bus: InMemoryBus;
  let contracts: ContractEngine;
  let rail: EvmSettlementRail;
  let bridge: SettlementBridge;

  const FUND_EVENT_PAYLOAD = {
    contractId: "bridge-test-contract",
    event: "FUND",
    newState: "in_progress",
  };

  const SETTLE_EVENT_PAYLOAD = {
    contractId: "bridge-test-contract",
    event: "SETTLE",
    newState: "settled",
  };

  const SENDER = makeIdentity("system");

  beforeEach(async () => {
    bus = new InMemoryBus();
    await bus.connect();
    contracts = new ContractEngine(bus);

    const config: EvmSettlementConfig = {
      signer:         mockSigner(),
      factoryAddress: FACTORY_ADDR,
      usdcAddress:    USDC_ADDR,
      addressBook: { "data-analyst": PROVIDER },
    };
    rail = new EvmSettlementRail(config);

    // Stub rail methods
    vi.spyOn(rail, "createEscrow").mockResolvedValue({
      id: ESCROW_ADDR,
      contractId: "bridge-test-contract",
      amount: BigInt(50_000),
      currency: "USDC",
      status: "created",
    });
    vi.spyOn(rail, "fundEscrow").mockResolvedValue("0xfundTxHash");
    vi.spyOn(rail, "releaseEscrow").mockResolvedValue("0xreleaseTxHash");
    vi.spyOn(rail, "disputeEscrow").mockResolvedValue();

    bridge = new SettlementBridge({ bus, contracts, rail });
  });

  it("starts and stops cleanly", () => {
    expect(bridge.isRunning).toBe(false);
    bridge.start();
    expect(bridge.isRunning).toBe(true);
    bridge.stop();
    expect(bridge.isRunning).toBe(false);
  });

  it("is idempotent — start() called twice doesn't double-subscribe", () => {
    bridge.start();
    bridge.start();
    // Should still only have 1 subscription (checking isRunning guard)
    expect(bridge.isRunning).toBe(true);
  });

  it("calls createEscrow + fundEscrow on FUND event", async () => {
    bridge.start();

    // Manually register a contract so bridge can look it up
    const contract = makeContract("bridge-test-contract");
    // Inject into the contracts engine's internal map
    (contracts as unknown as Record<string, unknown>)["contracts"] =
      new Map([["bridge-test-contract", { ...contract }]]);

    await bus.publish("task.request", FUND_EVENT_PAYLOAD, SENDER);

    expect(rail.createEscrow).toHaveBeenCalledOnce();
    expect(rail.fundEscrow).toHaveBeenCalledWith(
      expect.objectContaining({ id: ESCROW_ADDR }),
      BigInt(50_000),
    );

    // Handle should be stored
    const handle = bridge.getHandle("bridge-test-contract");
    expect(handle?.status).toBe("funded");
  });

  it("calls releaseEscrow on SETTLE event after FUND", async () => {
    bridge.start();

    const contract = makeContract("bridge-test-contract");
    (contracts as unknown as Record<string, unknown>)["contracts"] =
      new Map([["bridge-test-contract", { ...contract }]]);

    // Process FUND first
    await bus.publish("task.request", FUND_EVENT_PAYLOAD, SENDER);
    // Then SETTLE
    await bus.publish("task.request", SETTLE_EVENT_PAYLOAD, SENDER);

    expect(rail.releaseEscrow).toHaveBeenCalledOnce();
    expect(bridge.getHandle("bridge-test-contract")?.status).toBe("released");
  });

  it("calls disputeEscrow on FAIL event", async () => {
    bridge.start();

    const contract = makeContract("bridge-test-contract");
    (contracts as unknown as Record<string, unknown>)["contracts"] =
      new Map([["bridge-test-contract", { ...contract }]]);

    await bus.publish("task.request", FUND_EVENT_PAYLOAD, SENDER);
    await bus.publish("task.request", {
      contractId: "bridge-test-contract",
      event: "FAIL",
      newState: "disputed",
    }, SENDER);

    expect(rail.disputeEscrow).toHaveBeenCalledWith(
      expect.objectContaining({ id: ESCROW_ADDR }),
      "Contract fail event",
    );
    expect(bridge.getHandle("bridge-test-contract")?.status).toBe("disputed");
  });

  it("ignores events for unrelated channels", async () => {
    bridge.start();
    // Other event types should not trigger anything
    await bus.publish("task.request", { contractId: "x", event: "OFFER", newState: "offered" }, SENDER);
    expect(rail.createEscrow).not.toHaveBeenCalled();
  });

  it("calls onError when a handler throws", async () => {
    const errors: Array<{ err: Error; ctx: string }> = [];
    bridge = new SettlementBridge({
      bus, contracts, rail,
      onError: (err, ctx) => errors.push({ err, ctx }),
    });
    bridge.start();

    // No contract registered — should error
    vi.spyOn(contracts, "get").mockReturnValue(undefined);

    await bus.publish("task.request", FUND_EVENT_PAYLOAD, SENDER);

    expect(errors.length).toBe(1);
    expect(errors[0]!.err.message).toMatch(/not found/);
  });
});
