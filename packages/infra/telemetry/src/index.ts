import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { metrics, trace, type Context, type Meter as OtelMeter, type Tracer } from "@opentelemetry/api";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, type ReadableSpan, type Span, type SpanExporter, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { type ExportResult, ExportResultCode } from "@opentelemetry/core";
import type { AlertMetrics, AlertRule, CostResponse, LogFields, Logger, Telemetry } from "@sudsnik/contracts";
import type { Clock, Stop } from "@sudsnik/kernel";

class JsonlSpanExporter implements SpanExporter {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }
  export(spans: ReadableSpan[], cb: (r: ExportResult) => void): void {
    const lines = spans.map((s) =>
      JSON.stringify({
        traceId: s.spanContext().traceId,
        spanId: s.spanContext().spanId,
        parentSpanId: s.parentSpanContext?.spanId,
        name: s.name,
        scope: s.instrumentationScope.name,
        startWallMs: hrToMs(s.startTime),
        durationMs: hrToMs(s.duration),
        attributes: s.attributes,
        status: s.status.code,
        events: s.events.map((e) => ({ name: e.name, atWallMs: hrToMs(e.time), attributes: e.attributes })),
      }),
    );
    // Spans are buffered and flushed once a second, so a crash loses at most a second of trace.
    if (lines.length) appendFileSync(this.path, lines.join("\n") + "\n");
    cb({ code: ExportResultCode.SUCCESS });
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

function hrToMs([s, ns]: [number, number]): number {
  return s * 1000 + ns / 1e6;
}

class SimNowProcessor implements SpanProcessor {
  constructor(private readonly clock: Clock, private readonly next: SpanProcessor) {}
  onStart(span: Span, ctx: Context): void {
    span.setAttribute("sim.now", this.clock.now());
    this.next.onStart(span, ctx);
  }
  onEnd(span: ReadableSpan): void {
    this.next.onEnd(span);
  }
  shutdown(): Promise<void> {
    return this.next.shutdown();
  }
  forceFlush(): Promise<void> {
    return this.next.forceFlush();
  }
}

class ImmediateProcessor implements SpanProcessor {
  constructor(private readonly exporter: SpanExporter) {}
  onStart(): void {}
  onEnd(span: ReadableSpan): void {
    this.exporter.export([span], () => undefined);
  }
  shutdown(): Promise<void> {
    return this.exporter.shutdown();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

export interface TelemetryProviderOptions {
  dataDir: string;
  clock: Clock;
}

export interface TelemetryProvider {
  forService(service: string): Telemetry;
  shutdown(): Promise<void>;
}

class JsonlLogger implements Logger {
  constructor(private readonly path: string, private readonly clock: Clock, private readonly base: LogFields) {}
  private write(level: string, event: string, fields: LogFields) {
    appendFileSync(this.path, JSON.stringify({ ts: new Date().toISOString(), simNow: this.clock.now(), level, event, ...this.base, ...fields }) + "\n");
  }
  info(event: string, fields: LogFields = {}) {
    this.write("info", event, fields);
  }
  warn(event: string, fields: LogFields = {}) {
    this.write("warn", event, fields);
  }
  error(event: string, fields: LogFields = {}) {
    this.write("error", event, fields);
  }
  child(fields: LogFields): Logger {
    return new JsonlLogger(this.path, this.clock, { ...this.base, ...fields });
  }
}

/**
 * One provider per process. Spans go to `<dataDir>/otel/trace.jsonl` with the attribute `sim.now`;
 * each service's log records go to `<dataDir>/logs/<service>.jsonl`.
 */
export function createTelemetryProvider(opts: TelemetryProviderOptions): TelemetryProvider {
  const exporter = new JsonlSpanExporter(join(opts.dataDir, "otel", "trace.jsonl"));
  const tracerProvider = new BasicTracerProvider({ spanProcessors: [new SimNowProcessor(opts.clock, new ImmediateProcessor(exporter))] });
  const meterProvider = new MeterProvider();
  mkdirSync(join(opts.dataDir, "logs"), { recursive: true });
  return {
    forService(service) {
      const counters: Record<string, number> = {};
      const logger = new JsonlLogger(join(opts.dataDir, "logs", `${service}.jsonl`), opts.clock, { service });
      const otelMeter = meterProvider.getMeter(service);
      return {
        tracer: tracerProvider.getTracer(service),
        meter: otelMeter,
        logger,
        counter(name) {
          const c = otelMeter.createCounter(name);
          return {
            add(n = 1) {
              counters[name] = (counters[name] ?? 0) + n;
              c.add(n);
            },
          };
        },
        counters: () => ({ ...counters }),
      };
    },
    async shutdown() {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
    },
  };
}

/**
 * A repeating job whose failure is a log record rather than the end of the process. `clock.every` calls its function
 * and discards what it returns, so an async job that rejects would otherwise be an unhandled rejection and Node exits;
 * every one of these touches a database the drain closes underneath it.
 */
export function everyGuarded(clock: Clock, everyMs: number, event: string, run: () => Promise<void> | void, logger: Logger): Stop {
  return clock.every(everyMs, () => {
    try {
      void Promise.resolve(run()).catch((e: unknown) => logger.error(`${event}_failed`, { error: e instanceof Error ? e.message : String(e) }));
    } catch (e) {
      logger.error(`${event}_failed`, { error: e instanceof Error ? e.message : String(e) });
    }
  });
}

export function globalTracer(name: string): Tracer {
  return trace.getTracer(name);
}
export function globalMeter(name: string): OtelMeter {
  return metrics.getMeter(name);
}

export interface AlertRunner {
  rules: AlertRule[];
  stop: Stop;
  /** Evaluates every rule now, regardless of its period; the release driver's final sweep. */
  evaluateAll(): string[];
}

/**
 * Loads default-exported AlertRules from `dir` and evaluates each on the clock every `rule.every` ms.
 * A rule that returns true emits a log record with event "alert" and rule = name.
 */
export async function runAlerts(opts: { dir: string; clock: Clock; telemetry: Telemetry; cost: () => CostResponse }): Promise<AlertRunner> {
  const rules: AlertRule[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(opts.dir).filter((f) => /\.(ts|js|mjs)$/.test(f) && !f.endsWith(".d.ts")).sort();
  } catch {
    files = [];
  }
  for (const f of files) {
    const mod = (await import(pathToFileURL(join(opts.dir, f)).href)) as { default?: Partial<AlertRule> };
    const r = mod.default;
    if (!r || typeof r.name !== "string" || typeof r.every !== "number" || typeof r.evaluate !== "function") throw new TypeError(`${f}: default export is not an AlertRule`);
    rules.push(r as AlertRule);
  }
  const metricsNow = (): AlertMetrics => ({ cost: opts.cost(), counters: opts.telemetry.counters(), nowMs: opts.clock.now() });
  const evaluate = (rule: AlertRule): boolean => {
    let fired = false;
    try {
      fired = rule.evaluate(metricsNow());
    } catch (e) {
      opts.telemetry.logger.error("alert_rule_error", { rule: rule.name, error: e instanceof Error ? e.message : String(e) });
    }
    if (fired) opts.telemetry.logger.warn("alert", { rule: rule.name });
    return fired;
  };
  const stops = rules.map((rule) => opts.clock.every(rule.every, () => void evaluate(rule)));
  return {
    rules,
    stop: () => stops.forEach((s) => s()),
    evaluateAll: () => rules.filter(evaluate).map((r) => r.name),
  };
}
