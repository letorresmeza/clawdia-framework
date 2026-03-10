import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIdentity } from "@clawdia/types";

const streamInfo = vi.fn();
const streamAdd = vi.fn();
const jsPublish = vi.fn();
const jsSubscribe = vi.fn();
const basePublish = vi.fn();
const baseSubscribe = vi.fn();
const mockDrain = vi.fn();
const mockJetstream = vi.fn();
const mockJetstreamManager = vi.fn();
const mockConnect = vi.fn();

vi.mock("nats", () => ({
  connect: mockConnect,
  consumerOpts: () => {
    const state: Record<string, unknown> = {};
    return {
      durable: vi.fn((value: string) => {
        state["durable"] = value;
      }),
      manualAck: vi.fn(),
      ackExplicit: vi.fn(),
      deliverAll: vi.fn(),
      deliverTo: vi.fn((value: string) => {
        state["deliverTo"] = value;
      }),
      filterSubject: vi.fn((value: string) => {
        state["filterSubject"] = value;
      }),
      ackWait: vi.fn((value: number) => {
        state["ackWait"] = value;
      }),
      maxDeliver: vi.fn((value: number) => {
        state["maxDeliver"] = value;
      }),
      bindStream: vi.fn((value: string) => {
        state["bindStream"] = value;
      }),
      __state: state,
    };
  },
  createInbox: () => "_INBOX.test",
}));

function createMockIdentity(name: string): AgentIdentity {
  return {
    name,
    displayName: name,
    description: `Mock agent ${name}`,
    version: "1.0.0",
    operator: "test-operator",
    publicKey: `ed25519:${name}`,
    capabilities: [],
    requirements: [],
    runtime: { model: "test-model" },
  };
}

describe("NatsBus JetStream mode", () => {
  beforeEach(() => {
    vi.resetModules();
    streamInfo.mockReset();
    streamAdd.mockReset();
    jsPublish.mockReset();
    jsSubscribe.mockReset();
    basePublish.mockReset();
    baseSubscribe.mockReset();
    mockDrain.mockReset();
    mockJetstream.mockReset();
    mockJetstreamManager.mockReset();
    mockConnect.mockReset();

    mockJetstreamManager.mockResolvedValue({
      streams: {
        info: streamInfo,
        add: streamAdd,
      },
    });
    mockJetstream.mockReturnValue({
      publish: jsPublish,
      subscribe: jsSubscribe,
    });
    mockConnect.mockResolvedValue({
      jetstreamManager: mockJetstreamManager,
      jetstream: mockJetstream,
      publish: basePublish,
      subscribe: baseSubscribe,
      drain: mockDrain,
    });
  });

  it("creates the JetStream stream on first connect", async () => {
    streamInfo.mockRejectedValueOnce(new Error("missing"));

    const { NatsBus } = await import("../bus/nats-bus.js");
    const bus = new NatsBus({ jetstream: true });

    await bus.connect("nats://localhost:4222");

    expect(streamInfo).toHaveBeenCalledWith("CLAWDIA");
    expect(streamAdd).toHaveBeenCalledWith({
      name: "CLAWDIA",
      subjects: [">"],
    });
  });

  it("publishes through JetStream when enabled", async () => {
    streamInfo.mockResolvedValueOnce({ config: { name: "CLAWDIA" } });
    jsPublish.mockResolvedValueOnce({ seq: 1 });

    const { NatsBus } = await import("../bus/nats-bus.js");
    const bus = new NatsBus({ jetstream: true });
    const sender = createMockIdentity("publisher");

    await bus.connect();
    await bus.publish("task.request", { hello: "world" }, sender);

    expect(jsPublish).toHaveBeenCalledTimes(1);
    expect(basePublish).not.toHaveBeenCalled();
  });

  it("subscribes through JetStream with durable consumer options", async () => {
    streamInfo.mockResolvedValueOnce({ config: { name: "CLAWDIA" } });
    jsSubscribe.mockResolvedValueOnce((async function* () {})());

    const { NatsBus } = await import("../bus/nats-bus.js");
    const bus = new NatsBus({
      jetstream: {
        enabled: true,
        streamName: "CLAWDIA",
        subjectPattern: ">",
        consumerPrefix: "phase2",
        ackWaitMs: 15_000,
        maxDeliver: 7,
      },
    });

    await bus.connect();
    const subId = bus.subscribe("task.result", async () => {});

    expect(subId).toBeDefined();
    expect(jsSubscribe).toHaveBeenCalledTimes(1);
    const [, opts] = jsSubscribe.mock.calls[0] as [string, { __state: Record<string, unknown> }];
    expect(opts.__state["filterSubject"]).toBe("task.result");
    expect(opts.__state["bindStream"]).toBe("CLAWDIA");
    expect(opts.__state["ackWait"]).toBe(15_000);
    expect(opts.__state["maxDeliver"]).toBe(7);
    expect(String(opts.__state["durable"])).toContain("phase2-task-result-");
  });
});
