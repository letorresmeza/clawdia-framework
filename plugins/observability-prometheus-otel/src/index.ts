import type { IObservability, PluginModule } from "@clawdia/types";

interface MetricPoint {
  type: "counter" | "gauge" | "histogram";
  name: string;
  value: number;
  labels?: Record<string, string>;
}

interface TraceSpan {
  name: string;
  startedAt: string;
  durationMs: number;
}

export class PrometheusOtelObservability implements IObservability {
  readonly name = "prometheus-otel";
  private readonly metrics: MetricPoint[] = [];
  private readonly spans: TraceSpan[] = [];

  counter(name: string, value = 1, labels?: Record<string, string>): void {
    this.metrics.push({ type: "counter", name, value, labels });
  }

  histogram(name: string, value: number, labels?: Record<string, string>): void {
    this.metrics.push({ type: "histogram", name, value, labels });
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    this.metrics.push({ type: "gauge", name, value, labels });
  }

  async trace<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.spans.push({
        name,
        startedAt: new Date(start).toISOString(),
        durationMs: Date.now() - start,
      });
    }
  }

  renderPrometheus(): string {
    return this.metrics
      .map((metric) => `${metric.name}${formatLabels(metric.labels)} ${metric.value}`)
      .join("\n");
  }

  listSpans(): TraceSpan[] {
    return [...this.spans];
  }
}

function formatLabels(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return "";
  const rendered = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(",");
  return `{${rendered}}`;
}

export default {
  name: "prometheus-otel",
  type: "observability",
  create: () => new PrometheusOtelObservability(),
} satisfies PluginModule<PrometheusOtelObservability>;
