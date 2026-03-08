import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../state.js";

// ─────────────────────────────────────────────────────────
// StateManager — executionId methods
// ─────────────────────────────────────────────────────────

describe("StateManager — execution ID idempotency", () => {
  let state: StateManager;

  beforeEach(() => {
    state = new StateManager();
  });

  // ── Basic add and lookup ───────────────────────────────

  describe("addExecutionId / hasExecutionId", () => {
    it("returns false for an ID that has not been added", () => {
      expect(state.hasExecutionId("market-opportunity-scanner:2026-03-08T14:00")).toBe(false);
    });

    it("returns true after adding an ID", () => {
      const id = "market-opportunity-scanner:2026-03-08T14:00";
      state.addExecutionId(id);
      expect(state.hasExecutionId(id)).toBe(true);
    });

    it("correctly distinguishes between different IDs", () => {
      state.addExecutionId("job-a:2026-03-08T14:00");
      expect(state.hasExecutionId("job-a:2026-03-08T14:00")).toBe(true);
      expect(state.hasExecutionId("job-b:2026-03-08T14:00")).toBe(false);
    });

    it("allows adding multiple distinct IDs", () => {
      state.addExecutionId("job-a:2026-03-08T14:00");
      state.addExecutionId("job-b:2026-03-08T14:00");
      state.addExecutionId("job-c:2026-03-08T14:00");

      expect(state.hasExecutionId("job-a:2026-03-08T14:00")).toBe(true);
      expect(state.hasExecutionId("job-b:2026-03-08T14:00")).toBe(true);
      expect(state.hasExecutionId("job-c:2026-03-08T14:00")).toBe(true);
    });

    it("adding the same ID twice does not throw", () => {
      const id = "job-a:2026-03-08T14:00";
      expect(() => {
        state.addExecutionId(id);
        state.addExecutionId(id);
      }).not.toThrow();
      expect(state.hasExecutionId(id)).toBe(true);
    });
  });

  // ── Eviction at 10,000 ────────────────────────────────

  describe("eviction — capped at 10,000", () => {
    it("evicts oldest entry when adding the 10,001st ID", () => {
      // Add 10,000 IDs: "id-0" through "id-9999"
      for (let i = 0; i < 10_000; i++) {
        state.addExecutionId(`id-${i}`);
      }

      // All 10,000 should be present
      expect(state.hasExecutionId("id-0")).toBe(true);
      expect(state.hasExecutionId("id-9999")).toBe(true);

      // Add the 10,001st — "id-0" (the oldest) should be evicted
      state.addExecutionId("id-10000");

      expect(state.hasExecutionId("id-0")).toBe(false);   // evicted
      expect(state.hasExecutionId("id-9999")).toBe(true);  // still present
      expect(state.hasExecutionId("id-10000")).toBe(true); // newly added
    });

    it("array length stays at 10,000 after overflow", () => {
      for (let i = 0; i < 10_001; i++) {
        state.addExecutionId(`id-${i}`);
      }
      // Access internal state via get()
      const stateData = state.get();
      expect(stateData.scheduler.executionIds.length).toBe(10_000);
    });

    it("evicts in FIFO order — oldest first", () => {
      for (let i = 0; i < 10_000; i++) {
        state.addExecutionId(`id-${i}`);
      }

      // Add 3 more — should evict id-0, id-1, id-2 (in that order)
      state.addExecutionId("new-1");
      state.addExecutionId("new-2");
      state.addExecutionId("new-3");

      expect(state.hasExecutionId("id-0")).toBe(false);
      expect(state.hasExecutionId("id-1")).toBe(false);
      expect(state.hasExecutionId("id-2")).toBe(false);
      expect(state.hasExecutionId("id-3")).toBe(true);
      expect(state.hasExecutionId("new-1")).toBe(true);
      expect(state.hasExecutionId("new-2")).toBe(true);
      expect(state.hasExecutionId("new-3")).toBe(true);
    });
  });

  // ── Scheduler idempotency simulation ──────────────────

  describe("scheduler idempotency — same executionId is skipped", () => {
    it("simulates a job being skipped on second invocation with same executionId", () => {
      const executionId = "market-opportunity-scanner:2026-03-08T14:00";
      let jobRanCount = 0;

      // Simulate runJob logic: check before running, record after success
      function simulateRunJob(): string {
        if (state.hasExecutionId(executionId)) {
          return "skipped";
        }
        // "run" the job
        jobRanCount++;
        // Record after successful run
        state.addExecutionId(executionId);
        return "ran";
      }

      expect(simulateRunJob()).toBe("ran");
      expect(jobRanCount).toBe(1);
      expect(state.hasExecutionId(executionId)).toBe(true);

      // Second invocation with same executionId — should be skipped
      expect(simulateRunJob()).toBe("skipped");
      expect(jobRanCount).toBe(1); // still only ran once
    });

    it("allows the same job to run again in a different minute", () => {
      const firstMinute = "market-opportunity-scanner:2026-03-08T14:00";
      const secondMinute = "market-opportunity-scanner:2026-03-08T14:30";
      let jobRanCount = 0;

      function simulateRunJob(execId: string): string {
        if (state.hasExecutionId(execId)) {
          return "skipped";
        }
        jobRanCount++;
        state.addExecutionId(execId);
        return "ran";
      }

      expect(simulateRunJob(firstMinute)).toBe("ran");
      expect(simulateRunJob(firstMinute)).toBe("skipped");
      expect(simulateRunJob(secondMinute)).toBe("ran"); // different minute — allowed
      expect(jobRanCount).toBe(2);
    });

    it("different jobs in the same minute are not confused with each other", () => {
      const jobA = "job-a:2026-03-08T14:00";
      const jobB = "job-b:2026-03-08T14:00";

      state.addExecutionId(jobA);

      expect(state.hasExecutionId(jobA)).toBe(true);
      expect(state.hasExecutionId(jobB)).toBe(false);
    });
  });
});
