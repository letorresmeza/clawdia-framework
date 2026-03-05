import type { PluginModule } from "@clawdia/types";

/**
 * Type-safe helper for authoring a Clawdia plugin module.
 *
 * Enforces the `PluginModule` contract at compile time via `satisfies`.
 * Returns the module unchanged — purely a type helper.
 *
 * ```ts
 * export default definePlugin({
 *   name: "my-notifier",
 *   type: "notifier",
 *   version: "1.0.0",
 *   create: (config) => new MyNotifier(config),
 * });
 * ```
 */
export function definePlugin<T>(module: PluginModule<T>): PluginModule<T> {
  return module;
}
