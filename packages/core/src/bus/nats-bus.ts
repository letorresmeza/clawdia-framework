import {
  connect,
  consumerOpts,
  createInbox,
  type ConsumerOptsBuilder,
  type JetStreamClient,
  type JetStreamManager,
  type JetStreamSubscription,
  type JsMsg,
  type NatsConnection,
  type Subscription,
} from "nats";
import { v7 as uuid } from "uuid";
import type { ClawMessage, ClawChannel, AgentIdentity, MessageHandler } from "@clawdia/types";
import type { IClawBus, PublishOptions } from "./clawbus.js";

const DEFAULT_URL = "nats://localhost:4222";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface SubscriptionEntry {
  natsSubscription: Subscription | JetStreamSubscription;
  channel: ClawChannel;
  processing: Promise<void>;
  durableName?: string;
}

export interface JetStreamBusConfig {
  enabled: boolean;
  streamName?: string;
  subjectPattern?: string;
  consumerPrefix?: string;
  ackWaitMs?: number;
  maxDeliver?: number;
}

export interface NatsBusOptions {
  jetstream?: boolean | JetStreamBusConfig;
}

export class NatsBus implements IClawBus {
  private connection: NatsConnection | null = null;
  private connected = false;
  private subscriptions = new Map<string, SubscriptionEntry>();
  private seenIds: Set<string> = new Set();
  private seenIdsQueue: string[] = [];
  private jetstream: JetStreamClient | null = null;
  private jetstreamManager: JetStreamManager | null = null;
  private readonly jetstreamConfig: JetStreamBusConfig | null;

  constructor(options: NatsBusOptions = {}) {
    if (options.jetstream === true) {
      this.jetstreamConfig = {
        enabled: true,
        streamName: "CLAWDIA",
        subjectPattern: ">",
        consumerPrefix: "clawdia",
        ackWaitMs: 30_000,
        maxDeliver: 5,
      };
      return;
    }

    if (options.jetstream && options.jetstream.enabled) {
      this.jetstreamConfig = {
        enabled: true,
        streamName: options.jetstream.streamName ?? "CLAWDIA",
        subjectPattern: options.jetstream.subjectPattern ?? ">",
        consumerPrefix: options.jetstream.consumerPrefix ?? "clawdia",
        ackWaitMs: options.jetstream.ackWaitMs ?? 30_000,
        maxDeliver: options.jetstream.maxDeliver ?? 5,
      };
      return;
    }

    this.jetstreamConfig = null;
  }

  async connect(url?: string): Promise<void> {
    this.connection = await connect({ servers: url ?? DEFAULT_URL });
    if (this.jetstreamConfig?.enabled) {
      this.jetstreamManager = await this.connection.jetstreamManager();
      this.jetstream = this.connection.jetstream();
      await this.ensureJetStreamStream();
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connection) return;

    // Unsubscribe all active subscriptions so their iterators end
    for (const entry of this.subscriptions.values()) {
      entry.natsSubscription.unsubscribe();
    }

    // Wait for all background processors to finish
    await Promise.allSettled(Array.from(this.subscriptions.values()).map((s) => s.processing));

    this.subscriptions.clear();

    // Drain connection (flush pending and close)
    await this.connection.drain();
    this.connection = null;
    this.jetstream = null;
    this.jetstreamManager = null;
    this.connected = false;
  }

  async publish<T>(
    channel: ClawChannel,
    payload: T,
    sender: AgentIdentity,
    opts?: PublishOptions,
  ): Promise<string> {
    if (!this.connected || !this.connection) {
      throw new Error("Bus not connected");
    }

    const message: ClawMessage<T> = {
      id: uuid(),
      channel,
      timestamp: new Date().toISOString(),
      sender,
      recipient: opts?.recipient,
      correlationId: opts?.correlationId ?? uuid(),
      payload,
      signature: "", // TODO: sign with IdentityRuntime
      ttl: opts?.ttl,
      metadata: opts?.metadata,
    };

    // Deduplication: skip if we've already seen this message ID
    if (this.seenIds.has(message.id)) {
      console.warn(`[NatsBus] Duplicate message dropped: ${message.id}`);
      return message.id;
    }
    this.seenIds.add(message.id);
    this.seenIdsQueue.push(message.id);
    if (this.seenIdsQueue.length > 10_000) {
      const oldest = this.seenIdsQueue.shift()!;
      this.seenIds.delete(oldest);
    }

    const data = encoder.encode(JSON.stringify(message));
    if (this.jetstreamConfig?.enabled) {
      if (!this.jetstream) {
        throw new Error("JetStream client not initialized");
      }
      await this.jetstream.publish(channel, data);
    } else {
      this.connection.publish(channel, data);
    }

    return message.id;
  }

  subscribe<T>(channel: ClawChannel, handler: MessageHandler<T>): string {
    if (!this.connected || !this.connection) {
      throw new Error("Bus not connected");
    }

    const subId = uuid();
    if (this.jetstreamConfig?.enabled) {
      if (!this.jetstream) {
        throw new Error("JetStream client not initialized");
      }

      const durableName = this.buildDurableName(channel, subId);
      const opts = consumerOpts();
      opts.durable(durableName);
      opts.manualAck();
      opts.ackExplicit();
      opts.deliverAll();
      opts.deliverTo(createInbox());
      opts.filterSubject(channel);
      opts.ackWait(this.jetstreamConfig.ackWaitMs ?? 30_000);
      opts.maxDeliver(this.jetstreamConfig.maxDeliver ?? 5);
      opts.bindStream(this.jetstreamConfig.streamName ?? "CLAWDIA");

      const processing = this.processJetStreamSubscription(channel, opts, handler, subId, durableName);
      this.subscriptions.set(subId, {
        natsSubscription: { unsubscribe() {} } as Subscription,
        channel,
        processing,
        durableName,
      });
      return subId;
    }

    const natsSubscription = this.connection.subscribe(channel);
    const processing = this.processMessages(natsSubscription, handler);

    this.subscriptions.set(subId, { natsSubscription, channel, processing });
    return subId;
  }

  unsubscribe(subscriptionId: string): void {
    const entry = this.subscriptions.get(subscriptionId);
    if (entry) {
      entry.natsSubscription.unsubscribe();
      this.subscriptions.delete(subscriptionId);
    }
  }

  private async processMessages<T>(
    natsSub: Subscription,
    handler: MessageHandler<T>,
  ): Promise<void> {
    for await (const msg of natsSub) {
      try {
        const clawMessage = JSON.parse(decoder.decode(msg.data)) as ClawMessage<T>;
        await handler(clawMessage);
      } catch (err) {
        console.error("[NatsBus] Handler error:", err);
      }
    }
  }

  private async processJetStreamSubscription<T>(
    channel: ClawChannel,
    opts: ConsumerOptsBuilder,
    handler: MessageHandler<T>,
    subId: string,
    durableName: string,
  ): Promise<void> {
    if (!this.jetstream) {
      throw new Error("JetStream client not initialized");
    }

    const jsSub = await this.jetstream.subscribe(channel, opts);
    this.subscriptions.set(subId, {
      natsSubscription: jsSub,
      channel,
      processing: this.subscriptions.get(subId)?.processing ?? Promise.resolve(),
      durableName,
    });

    for await (const msg of jsSub) {
      await this.handleJetStreamMessage(msg, handler);
    }
  }

  private async handleJetStreamMessage<T>(msg: JsMsg, handler: MessageHandler<T>): Promise<void> {
    try {
      const clawMessage = JSON.parse(decoder.decode(msg.data)) as ClawMessage<T>;
      await handler(clawMessage);
      msg.ack();
    } catch (err) {
      console.error("[NatsBus] JetStream handler error:", err);
      msg.nak();
    }
  }

  private async ensureJetStreamStream(): Promise<void> {
    if (!this.jetstreamManager || !this.jetstreamConfig?.enabled) {
      return;
    }

    const streamName = this.jetstreamConfig.streamName ?? "CLAWDIA";
    try {
      await this.jetstreamManager.streams.info(streamName);
    } catch {
      await this.jetstreamManager.streams.add({
        name: streamName,
        subjects: [this.jetstreamConfig.subjectPattern ?? ">"],
      });
    }
  }

  private buildDurableName(channel: ClawChannel, subId: string): string {
    const prefix = this.jetstreamConfig?.consumerPrefix ?? "clawdia";
    const normalizedChannel = channel.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return `${prefix}-${normalizedChannel}-${subId}`.slice(0, 64);
  }
}
