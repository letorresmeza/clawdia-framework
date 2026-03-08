import { v7 as uuid } from "uuid";
import type {
  ClawMessage,
  ClawChannel,
  AgentIdentity,
  MessageHandler,
} from "@clawdia/types";

// ─────────────────────────────────────────────────────────
// Bus Interface — implemented by both InMemoryBus and NatsBus
// ─────────────────────────────────────────────────────────

export interface IClawBus {
  connect(url?: string): Promise<void>;
  disconnect(): Promise<void>;
  publish<T>(
    channel: ClawChannel,
    payload: T,
    sender: AgentIdentity,
    opts?: PublishOptions,
  ): Promise<string>;
  subscribe<T>(channel: ClawChannel, handler: MessageHandler<T>): string;
  unsubscribe(subscriptionId: string): void;
}

export interface PublishOptions {
  recipient?: string;
  correlationId?: string;
  ttl?: number;
  metadata?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────
// In-Memory Bus — for development and testing
// ─────────────────────────────────────────────────────────

export class InMemoryBus implements IClawBus {
  private handlers = new Map<string, Map<string, MessageHandler<any>>>();
  private deadLetterQueue: ClawMessage[] = [];
  private connected = false;
  private seenIds: Set<string> = new Set();
  private seenIdsQueue: string[] = [];

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.handlers.clear();
    this.connected = false;
  }

  async publish<T>(
    channel: ClawChannel,
    payload: T,
    sender: AgentIdentity,
    opts?: PublishOptions,
  ): Promise<string> {
    if (!this.connected) throw new Error("Bus not connected");

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
      console.warn(`[ClawBus] Duplicate message dropped: ${message.id}`);
      return message.id;
    }
    this.seenIds.add(message.id);
    this.seenIdsQueue.push(message.id);
    if (this.seenIdsQueue.length > 10_000) {
      const oldest = this.seenIdsQueue.shift()!;
      this.seenIds.delete(oldest);
    }

    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      for (const [subId, handler] of channelHandlers) {
        try {
          await handler(message);
        } catch (err) {
          console.error(`[ClawBus] Handler error on ${channel}/${subId}:`, err);
          this.deadLetterQueue.push(message);
        }
      }
    }

    return message.id;
  }

  subscribe<T>(channel: ClawChannel, handler: MessageHandler<T>): string {
    if (!this.connected) throw new Error("Bus not connected");

    const subId = uuid();
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Map());
    }
    this.handlers.get(channel)!.set(subId, handler);
    return subId;
  }

  unsubscribe(subscriptionId: string): void {
    for (const channelHandlers of this.handlers.values()) {
      channelHandlers.delete(subscriptionId);
    }
  }

  /** Get dead letter queue contents (for testing) */
  getDeadLetterQueue(): ClawMessage[] {
    return [...this.deadLetterQueue];
  }

  /** Clear dead letter queue (for testing) */
  clearDeadLetterQueue(): void {
    this.deadLetterQueue = [];
  }

  /** Get handler count for a channel (for testing) */
  getHandlerCount(channel: ClawChannel): number {
    return this.handlers.get(channel)?.size ?? 0;
  }

  /** Get count of tracked seen message IDs (for testing) */
  getSeenIdsCount(): number {
    return this.seenIds.size;
  }
}
