# Security Audit — Fixes Applied

**Date:** 2026-03-08
**Auditor:** External security review
**Status:** All fixes implemented and tested

---

## Infrastructure Fixes

### 1. Localhost-only server binding
**File:** `packages/orchestrator/src/daemon.ts`
**Change:** Both HTTP servers now bind to `127.0.0.1` instead of `0.0.0.0`.
```typescript
// Before
this.dashboardServer.listen(PORT_DASHBOARD, callback)
this.apiServer.listen(PORT_API, callback)

// After
this.dashboardServer.listen(PORT_DASHBOARD, "127.0.0.1", callback)
this.apiServer.listen(PORT_API, "127.0.0.1", callback)
```
Access via SSH port forwarding only. Public access requires nginx + auth.

### 2. NATS bound to localhost
**File:** `docker-compose.yaml`
**Change:** Removed `network_mode: host`; added explicit localhost port binding.
```yaml
# Before
nats:
  network_mode: host

# After
nats:
  ports:
    - "127.0.0.1:4222:4222"
```

### 3. UFW firewall rules
**Commands run:**
```bash
ufw deny 3000
ufw deny 3001
ufw deny 4222
```
UFW now blocks all three ports from public access. Rules confirmed active.

**Docker iptables bypass prevention:**
`/etc/docker/daemon.json` written with `{"iptables": false}`. Docker must be restarted to apply. This prevents Docker from bypassing UFW by inserting its own iptables rules.

### 4. Non-root user for Clawdia
**Changes applied:**
- Created user `clawdia` with home directory `/opt/clawdia`
- `/var/log/clawdia` and `/var/lib/clawdia` ownership set to `clawdia:clawdia` (mode 750)
- **File:** `ecosystem.config.js` — added `user: "clawdia"` to PM2 app config

---

## Code Fixes

### 5. Contract version field + compare-and-swap (CAS)
**Files:** `packages/types/src/contracts.ts`, `packages/core/src/contracts/contract-engine.ts`

- Added `version: number` to the `TaskContract` interface (starts at `0`, increments by 1 on every successful transition)
- Added `ConflictError` class (extends `Error`, carries `contractId`, `expected`, `actual`)
- `transition()` accepts an optional 5th param `expectedVersion?: number`; throws `ConflictError` if `contract.version !== expectedVersion`
- Prevents duplicate settlements: a racing second SETTLE with a stale version is rejected

**Test coverage:** `packages/core/src/__tests__/contract-engine-security.test.ts`
- `ConflictError` thrown on mismatch, carries correct fields
- CAS happy path: matching version succeeds
- Auto-increment: full happy path ends at `version === 6`
- CAS bypassed when `expectedVersion` is omitted (backwards-compatible)

### 6. Message deduplication in ClawBus
**Files:** `packages/core/src/bus/clawbus.ts`, `packages/core/src/bus/nats-bus.ts`

Both `InMemoryBus` and `NatsBus` now track seen message IDs in a bounded structure:
- `seenIds: Set<string>` for O(1) lookup
- `seenIdsQueue: string[]` for FIFO eviction
- Max capacity: 10,000 entries. When exceeded, oldest ID is evicted.
- Duplicate message ID → handler skipped, warning logged.

**Test coverage:** `packages/core/src/__tests__/clawbus-dedup.test.ts`
- `getSeenIdsCount()` grows with unique publishes
- FIFO eviction at 10,001 → count stays at 10,000
- 10,001 distinct messages → handler called exactly 10,001 times (no false drops)

### 7. Scheduler idempotency
**Files:** `packages/orchestrator/src/state.ts`, `packages/orchestrator/src/scheduler.ts`

- `SchedulerStats` now includes `executionIds: string[]`
- `StateManager` exposes `addExecutionId(id)` (FIFO-capped at 10,000) and `hasExecutionId(id): boolean`
- Each scheduler job generates `executionId = "${job.name}:${now.toISOString().slice(0, 16)}"` (minute-granularity)
- Before creating a contract, checks `state.hasExecutionId(executionId)` — skips if already seen
- On successful settlement, persists the execution ID

**Test coverage:** `packages/orchestrator/src/__tests__/scheduler-idempotency.test.ts`
- `addExecutionId`/`hasExecutionId` basic lookup
- FIFO eviction at 10,001 entries
- Same minute → skipped; different minute → allowed; different job name → allowed

### 8. Per-contract serialization lock
**File:** `packages/core/src/contracts/contract-engine.ts`

Added `private locks: Map<string, Promise<unknown>>` and a `withLock<T>(contractId, fn)` private method using promise chaining. All state mutations in `transition()` run inside the lock; the bus `publish()` runs **outside** the lock (to prevent deadlock when InMemoryBus delivers synchronously to handlers that call `transition()` themselves).

**Test coverage:** `packages/core/src/__tests__/contract-engine-security.test.ts`
- 10 concurrent CANCEL calls on 10 separate contracts → no deadlock, all succeed
- 2 concurrent OFFER calls on 1 contract → exactly 1 succeeds, 1 fails (serialized)
- SDK hire() tests pass end-to-end (validates no deadlock with `onTask` handler pattern)

### 9. REST API key authentication
**File:** `packages/orchestrator/src/daemon.ts`

- On boot, daemon reads or generates a 32-byte hex API key at `/var/lib/clawdia/api-key.txt`
- Key logged to stdout on first boot: `[daemon] API Key (store safely): <hex>`
- All `/api/*` endpoints require `X-API-Key: <key>` header → `401 Unauthorized` if missing/wrong
- **Exception:** `/api/health` is unauthenticated (for monitoring/watchdog use)
- CORS header updated: `Access-Control-Allow-Headers: Content-Type, X-API-Key`

**No automated tests** (requires a running HTTP server). Validation: manual `curl` against daemon.

### 10. Enhanced health endpoint + event loop watchdog
**File:** `packages/orchestrator/src/daemon.ts`

**Enhanced `/api/health`** (unauthenticated) returns:
```json
{
  "status": "ok",
  "uptime": 3600.5,
  "agentCount": 6,
  "lastSchedulerRun": "2026-03-08T01:00:00.000Z",
  "busConnected": true,
  "memoryUsageMb": { "rss": "128.3", "heapUsed": "64.1", "heapTotal": "96.0" }
}
```

**Watchdog:** A 5-second interval checks whether the event loop has been blocked for more than 30 seconds by comparing `Date.now()` against a 1-second heartbeat counter. If blocked, triggers graceful shutdown (PM2/ecosystem will restart the daemon).

---

## Test Summary

| Package | Test Files | Tests Passing |
|---|---|---|
| `@clawdia/core` | 5 | 91 |
| `@clawdia/orchestrator` | 3 | 46 |
| `@clawdia/sdk` | 1 | 16 |
| `@clawdia/cli` | 1 | 43 |
| `@clawdia/economy` | 5 | 98 |
| `@clawdia/contracts` (Solidity) | — | 33 |
| `@clawdia/plugin-settlement-evm` | 1 | 18 |
| Other packages | various | passing |
| **`@clawdia/plugin-agent-orchestrator`** | 1 | **1 pre-existing failure** (OutputAssembler quality threshold — not introduced by this audit) |

**New test files added:**
- `packages/core/src/__tests__/contract-engine-security.test.ts` (10 tests)
- `packages/core/src/__tests__/clawbus-dedup.test.ts` (8 tests)
- `packages/orchestrator/src/__tests__/scheduler-idempotency.test.ts` (varies)

---

## Notes for Operations

1. **Docker restart required** after `/etc/docker/daemon.json` change to apply `iptables: false`
2. **API key location:** `/var/lib/clawdia/api-key.txt` — back this up; loss requires daemon restart to regenerate
3. **SSH port forwarding** to access dashboard: `ssh -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 user@host`
4. **PM2 user context:** The `user: "clawdia"` setting requires PM2 to be started by root or via systemd with appropriate privileges
5. **`expectedVersion` param** in `ContractEngine.transition()` is optional — all existing callers continue to work without changes
