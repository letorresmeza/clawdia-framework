import { connect, type NatsConnection, type Subscription } from "nats";
import { v7 as uuid } from "uuid";
import type {
  ClawMessage,
  ClawChannel,
  AgentIdentity,
  MessageHandler,
} from "@clawdia/types";
import type { IClawBus, PublishOptions } from "./clawbus.js";

const DEFAULT_URL = "nats://localhost:4222";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface SubscriptionEntry {
  natsSubscription: Subscription;
  channel: ClawChannel;
  processing: Promise<void>;
}

export class NatsBus implements IClawBus {
  private connection: NatsConnection | null = null;
  private connected = false;
  private subscriptions = new Map<string, SubscriptionEntry>();

  async connect(url?: string): Promise<void> {
    this.connection = await connect({ servers: url ?? DEFAULT_URL });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connection) return;

    // Unsubscribe all active subscriptions so their iterators end
    for (const entry of this.subscriptions.values()) {
      entry.natsSubscription.unsubscribe();
    }

    // Wait for all background processors to finish
    await Promise.allSettled(
      Array.from(this.subscriptions.values()).map((s) => s.processing),
    );

    this.subscriptions.clear();

    // Drain connection (flush pending and close)
    await this.connection.drain();
    this.connection = null;
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

    const data = encoder.encode(JSON.stringify(message));
    this.connection.publish(channel, data);

    return message.id;
  }

  subscribe<T>(channel: ClawChannel, handler: MessageHandler<T>): string {
    if (!this.connected || !this.connection) {
      throw new Error("Bus not connected");
    }

    const subId = uuid();
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
}
