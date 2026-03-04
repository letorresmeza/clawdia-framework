import type { PluginModule, PluginType } from "@clawdia/types";
import { readdirSync, existsSync } from "fs";
import { join } from "path";

// ─────────────────────────────────────────────────────────
// Plugin Registry — manages loaded plugins by type
// ─────────────────────────────────────────────────────────

export class PluginRegistry {
  private plugins = new Map<PluginType, Map<string, PluginModule>>();

  /** Register a plugin */
  register(plugin: PluginModule): void {
    if (!this.plugins.has(plugin.type as PluginType)) {
      this.plugins.set(plugin.type as PluginType, new Map());
    }
    this.plugins.get(plugin.type as PluginType)!.set(plugin.name, plugin);
  }

  /** Get a specific plugin by type and name */
  get<T>(type: PluginType, name: string): T {
    const typePlugins = this.plugins.get(type);
    if (!typePlugins) {
      throw new Error(`No plugins registered for type "${type}"`);
    }
    const plugin = typePlugins.get(name);
    if (!plugin) {
      const available = Array.from(typePlugins.keys()).join(", ");
      throw new Error(
        `Plugin "${name}" not found for type "${type}". Available: ${available}`,
      );
    }
    return plugin.create() as T;
  }

  /** Get the first available plugin for a type */
  getDefault<T>(type: PluginType): T | undefined {
    const typePlugins = this.plugins.get(type);
    if (!typePlugins || typePlugins.size === 0) return undefined;
    const first = typePlugins.values().next().value;
    return first ? (first.create() as T) : undefined;
  }

  /** List all plugins of a given type */
  list(type: PluginType): string[] {
    return Array.from(this.plugins.get(type)?.keys() ?? []);
  }

  /** List all registered plugins */
  listAll(): Array<{ name: string; type: PluginType; version?: string }> {
    const result: Array<{ name: string; type: PluginType; version?: string }> = [];
    for (const [type, plugins] of this.plugins) {
      for (const [name, plugin] of plugins) {
        result.push({ name, type, version: plugin.version });
      }
    }
    return result;
  }
}

// ─────────────────────────────────────────────────────────
// Auto-loader — scans a directory for plugin packages
// ─────────────────────────────────────────────────────────

export async function loadPluginsFromDirectory(
  dir: string,
  registry: PluginRegistry,
): Promise<void> {
  if (!existsSync(dir)) {
    console.warn(`[Plugins] Directory not found: ${dir}`);
    return;
  }

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginPath = join(dir, entry.name);
    const indexPath = join(pluginPath, "dist", "index.js");

    if (!existsSync(indexPath)) {
      console.warn(`[Plugins] No dist/index.js in ${entry.name}, skipping`);
      continue;
    }

    try {
      const mod = await import(indexPath);
      const plugin: PluginModule = mod.default ?? mod;

      if (!plugin.name || !plugin.type || !plugin.create) {
        console.warn(`[Plugins] Invalid plugin module in ${entry.name}, skipping`);
        continue;
      }

      registry.register(plugin);
      console.log(`[Plugins] Loaded ${plugin.type}/${plugin.name}`);
    } catch (err) {
      console.error(`[Plugins] Failed to load ${entry.name}:`, err);
    }
  }
}
