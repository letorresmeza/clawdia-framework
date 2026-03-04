// @clawdia/core — The kernel of the Clawdia Framework

export { InMemoryBus } from "./bus/clawbus.js";
export type { IClawBus, PublishOptions } from "./bus/clawbus.js";

export { IdentityRuntime } from "./identity/identity-runtime.js";

export { ContractEngine } from "./contracts/contract-engine.js";

export { RiskEngine } from "./risk/risk-engine.js";
export type { AgentBudget, ResourceType, CircuitBreaker, BreakerState, RiskEngineConfig } from "./risk/risk-engine.js";

export { PluginRegistry, loadPluginsFromDirectory } from "./plugins/loader.js";
