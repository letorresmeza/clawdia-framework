/**
 * notifier-telegram — Telegram notification plugin for Clawdia Framework
 *
 * Implements INotifierPlugin. Reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 * from environment (or plugin config). Respects quiet hours from risk.json
 * (5–14 UTC). Severity levels: info (no prefix), warning (⚠️), critical (🚨).
 */

import * as https from "node:https";
import type { INotifierPlugin, Notification, PluginModule } from "@clawdia/types";

// Quiet hours from /root/clawdia-v3/config/risk.json: "quiet_hours_utc": [5, 14]
const DEFAULT_QUIET_START_UTC = 5;
const DEFAULT_QUIET_END_UTC = 14;

class TelegramNotifier implements INotifierPlugin {
  readonly name = "notifier-telegram";

  private readonly botToken: string;
  private readonly chatId: string;
  private readonly quietStart: number;
  private readonly quietEnd: number;

  constructor(config: Record<string, unknown> = {}) {
    this.botToken =
      (config["TELEGRAM_BOT_TOKEN"] as string | undefined) ??
      process.env["TELEGRAM_BOT_TOKEN"] ??
      "";
    this.chatId =
      (config["TELEGRAM_CHAT_ID"] as string | undefined) ??
      process.env["TELEGRAM_CHAT_ID"] ??
      "";
    const qh = config["quiet_hours_utc"] as [number, number] | undefined;
    this.quietStart = qh?.[0] ?? DEFAULT_QUIET_START_UTC;
    this.quietEnd = qh?.[1] ?? DEFAULT_QUIET_END_UTC;
  }

  private isQuietHours(): boolean {
    const hour = new Date().getUTCHours();
    return hour >= this.quietStart && hour < this.quietEnd;
  }

  private formatMessage(n: Notification): string {
    const prefix =
      n.level === "critical" ? "🚨 " : n.level === "warning" ? "⚠️ " : "";
    // MarkdownV2 requires escaping special chars
    return `${prefix}*${escapeMarkdownV2(n.title)}*\n${escapeMarkdownV2(n.body)}`;
  }

  async send(notification: Notification): Promise<void> {
    if (!this.botToken || !this.chatId) return;
    // Suppress info-level messages during quiet hours
    if (notification.level === "info" && this.isQuietHours()) return;

    const text = this.formatMessage(notification);
    await this.post({ chat_id: this.chatId, text, parse_mode: "MarkdownV2" });
  }

  async sendBatch(notifications: Notification[]): Promise<void> {
    if (!this.botToken || !this.chatId || notifications.length === 0) return;

    const critical = notifications.filter((n) => n.level === "critical");
    const rest = notifications.filter((n) => n.level !== "critical");

    // Critical messages bypass quiet hours and are sent immediately as a group
    if (critical.length > 0) {
      const text = critical.map((n) => this.formatMessage(n)).join("\n\n");
      await this.post({ chat_id: this.chatId, text, parse_mode: "MarkdownV2" });
    }

    if (rest.length > 0 && !this.isQuietHours()) {
      const text = rest
        .map((n) => this.formatMessage(n))
        .join("\n\n" + escapeMarkdownV2("---") + "\n\n");
      await this.post({ chat_id: this.chatId, text, parse_mode: "MarkdownV2" });
    }
  }

  private post(body: Record<string, unknown>): Promise<void> {
    if (!this.botToken) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = https.request(
        {
          hostname: "api.telegram.org",
          path: `/bot${this.botToken}/sendMessage`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          res.resume();
          if ((res.statusCode ?? 200) >= 400) {
            reject(new Error(`Telegram API ${res.statusCode}: ${res.statusMessage}`));
          } else {
            resolve();
          }
        },
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

export default {
  name: "notifier-telegram",
  type: "notifier",
  version: "0.1.0",
  create: (config?: Record<string, unknown>) =>
    new TelegramNotifier(config ?? {}),
} satisfies PluginModule<TelegramNotifier>;
