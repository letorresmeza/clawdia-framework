import { describe, expect, it } from "vitest";
import { PrometheusOtelObservability } from "../index.js";

describe("PrometheusOtelObservability", () => {
  it("records metrics and renders Prometheus output", () => {
    const obs = new PrometheusOtelObservability();
    obs.counter("clawdia_requests_total", 2, { tenant: "alpha" });
    obs.gauge("clawdia_agents_online", 5);

    const text = obs.renderPrometheus();
    expect(text).toContain('clawdia_requests_total{tenant="alpha"} 2');
    expect(text).toContain("clawdia_agents_online 5");
  });

  it("captures trace spans", async () => {
    const obs = new PrometheusOtelObservability();
    await obs.trace("workflow.execute", async () => {
      return "ok";
    });

    expect(obs.listSpans()).toHaveLength(1);
    expect(obs.listSpans()[0]?.name).toBe("workflow.execute");
  });
});
