"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MODELS,
  DEFAULT_PROMPT,
  RUNS_MIN,
  RUNS_MAX,
  RUNS_DEFAULT,
  TEMP_MIN,
  TEMP_MAX,
  TEMP_DEFAULT,
  TEMP_STEP_NOTE,
  PROVIDER_LABEL,
  type Provider,
  type StreamMessage,
} from "@/lib/models";
import {
  uniqueRatio,
  avgConsecutiveJaccard,
  computeDuplicates,
  verdictFor,
  type DuplicateInfo,
} from "@/lib/analytics";

// ── local types ──────────────────────────────────────────────────────────────
type CellStatus = "pending" | "done" | "error";
interface Cell {
  status: CellStatus;
  joke?: string;
  error?: string;
  latencyMs?: number;
}
type ResultMap = Record<string, Cell>;
type RunStatus = "idle" | "running" | "done" | "error";

const cellKey = (modelId: string, run: number) => `${modelId}#${run}`;

const PROVIDER_ACCENT: Record<Provider, string> = {
  openai: "#0F9D74",
  anthropic: "#CC785C",
  google: "#4079ED",
};

const VERDICT_COLOR: Record<"good" | "mixed" | "bad", string> = {
  good: "#0F9D74",
  mixed: "#C08A2B",
  bad: "#B4472E",
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function Dashboard() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [runs, setRuns] = useState(RUNS_DEFAULT);
  const [temperature, setTemperature] = useState(TEMP_DEFAULT);

  const [status, setStatus] = useState<RunStatus>("idle");
  const [results, setResults] = useState<ResultMap>({});
  const [topError, setTopError] = useState<string | null>(null);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  // live elapsed timer while running
  useEffect(() => {
    if (status !== "running" || startedAt === null) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(id);
  }, [status, startedAt]);

  const totalCells = MODELS.length * runs;
  const completed = useMemo(
    () => Object.values(results).filter((c) => c.status !== "pending").length,
    [results],
  );

  const run = useCallback(async () => {
    // seed every cell as pending so the matrix renders its full shape up front
    const seed: ResultMap = {};
    for (const m of MODELS)
      for (let r = 0; r < runs; r++) seed[cellKey(m.id, r)] = { status: "pending" };
    setResults(seed);
    setTopError(null);
    setStatus("running");
    const start = Date.now();
    setStartedAt(start);
    setElapsed(0);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runs, temperature, prompt }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Request failed (HTTP ${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // read NDJSON: one message per line, applied the instant it arrives
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg: StreamMessage;
          try {
            msg = JSON.parse(line) as StreamMessage;
          } catch {
            continue;
          }
          if (msg.type === "result") {
            setResults((prev) => ({
              ...prev,
              [cellKey(msg.modelId, msg.run)]: {
                status: "done",
                joke: msg.joke,
                latencyMs: msg.latencyMs,
              },
            }));
          } else if (msg.type === "error") {
            setResults((prev) => ({
              ...prev,
              [cellKey(msg.modelId, msg.run)]: {
                status: "error",
                error: msg.error,
                latencyMs: msg.latencyMs,
              },
            }));
          }
        }
      }
      setElapsed(Date.now() - start);
      setStatus("done");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setStatus("idle");
        return;
      }
      setTopError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }, [runs, temperature, prompt]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    setResults({});
    setStatus("idle");
    setTopError(null);
    setStartedAt(null);
    setElapsed(0);
  }, []);

  // ── derive per-model cells + live analytics ────────────────────────────────
  const perModel = useMemo(() => {
    return MODELS.map((model) => {
      const cells: Cell[] = [];
      for (let r = 0; r < runs; r++)
        cells.push(results[cellKey(model.id, r)] ?? { status: "pending" });

      const done = cells
        .map((c, r) => ({ c, r }))
        .filter((x) => x.c.status === "done" && x.c.joke != null);

      const orderedJokes = done.map((x) => x.c.joke as string);
      const dups = computeDuplicates(
        done.map((x) => ({ key: x.r, text: x.c.joke as string })),
      );

      // groupId -> the run indices that collapsed together
      const groupRuns = new Map<number, number[]>();
      for (const [r, info] of dups) {
        const arr = groupRuns.get(info.groupId);
        if (arr) arr.push(r);
        else groupRuns.set(info.groupId, [r]);
      }
      for (const arr of groupRuns.values()) arr.sort((a, b) => a - b);

      const latencies = cells
        .filter((c) => c.latencyMs != null)
        .map((c) => c.latencyMs as number);
      const avgLatency = latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null;

      return {
        model,
        cells,
        dups,
        groupRuns,
        uniq: uniqueRatio(orderedJokes),
        jac: avgConsecutiveJaccard(orderedJokes),
        verdict: verdictFor(uniqueRatio(orderedJokes)),
        errors: cells.filter((c) => c.status === "error").length,
        doneCount: orderedJokes.length,
        avgLatency,
      };
    });
  }, [results, runs]);

  const isRunning = status === "running";
  const hasResults = Object.keys(results).length > 0;

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8 sm:py-14">
      <Header />

      <div className="mt-10 lg:grid lg:grid-cols-[296px_1fr] lg:gap-9">
        {/* ── Config rail ─────────────────────────────────────────────── */}
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <section className="rounded-xl border border-hairline bg-surface p-5 shadow-card">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
              Configuration
            </h2>

            <div className="mt-5 space-y-6">
              <Field label="Prompt" hint="Sent verbatim to every model.">
                <input
                  type="text"
                  value={prompt}
                  disabled={isRunning}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-ink disabled:opacity-60"
                  placeholder={DEFAULT_PROMPT}
                />
              </Field>

              <Field
                label="Runs per model"
                value={String(runs)}
                hint={`${totalCells} total calls (${runs} × ${MODELS.length} models).`}
              >
                <input
                  type="range"
                  min={RUNS_MIN}
                  max={RUNS_MAX}
                  step={1}
                  value={runs}
                  disabled={isRunning}
                  onChange={(e) => setRuns(Number(e.target.value))}
                  className="slider mt-1"
                  aria-label="Runs per model"
                />
              </Field>

              <Field
                label="Temperature"
                value={temperature.toFixed(1)}
                hint={TEMP_STEP_NOTE}
              >
                <input
                  type="range"
                  min={TEMP_MIN}
                  max={TEMP_MAX}
                  step={0.1}
                  value={temperature}
                  disabled={isRunning}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="slider mt-1"
                  aria-label="Temperature"
                />
              </Field>
            </div>

            <div className="mt-7 flex flex-col gap-2">
              {!isRunning ? (
                <button
                  onClick={run}
                  className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:bg-black"
                >
                  {hasResults ? "Run again" : "Run benchmark"}
                </button>
              ) : (
                <button
                  onClick={cancel}
                  className="rounded-md border border-signal px-4 py-2.5 text-sm font-medium text-signal transition hover:bg-signal/5"
                >
                  Cancel run
                </button>
              )}
              {hasResults && !isRunning && (
                <button
                  onClick={reset}
                  className="rounded-md border border-hairline px-4 py-2 text-sm text-muted transition hover:bg-hairline/30"
                >
                  Clear results
                </button>
              )}
            </div>
          </section>

          <ModelLegend />
        </aside>

        {/* ── Main column ─────────────────────────────────────────────── */}
        <div className="mt-8 lg:mt-0">
          <ProgressBar
            status={status}
            completed={completed}
            total={totalCells}
            elapsed={elapsed}
            topError={topError}
          />

          {!hasResults ? (
            <EmptyState />
          ) : (
            <>
              <SectionTitle index="01" title="Diversity readout">
                Per-model scores. Lower self-similarity and a higher unique
                ratio mean more open-ended output.
              </SectionTitle>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {perModel.map((m) => (
                  <AnalyticsCard key={m.model.id} data={m} runs={runs} />
                ))}
              </div>

              <SectionTitle index="02" title="Generated jokes">
                Raw output, one row per run. Cells sharing an exact string are
                tinted with a matching colour.
              </SectionTitle>
              <Matrix perModel={perModel} runs={runs} />
            </>
          )}

          <Definitions />
        </div>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentational pieces (co-located with the single dashboard component)
// ─────────────────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-signal" />
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
            Open-endedness benchmark
          </span>
        </div>
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.16em] text-faint sm:block">
          {MODELS.length} models · {new Set(MODELS.map((m) => m.provider)).size}{" "}
          providers
        </span>
      </div>

      <h1 className="mt-5 font-display text-5xl leading-[0.95] tracking-tight text-ink sm:text-6xl">
        Can LLMs be funny?
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
        Ask each model to{" "}
        <span className="font-mono text-ink">&ldquo;tell me a joke&rdquo;</span>{" "}
        several times, then measure how much it repeats itself. This scores
        response <em className="not-italic text-ink">diversity</em> —
        open-endedness — rather than whether the jokes actually land.
      </p>
    </header>
  );
}

function Field({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-[13px] font-medium text-ink">{label}</label>
        {value !== undefined && (
          <span className="font-mono text-sm tabular-nums text-ink">
            {value}
          </span>
        )}
      </div>
      <div className="mt-2">{children}</div>
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-faint">{hint}</p>}
    </div>
  );
}

function ModelLegend() {
  return (
    <section className="mt-4 rounded-xl border border-hairline bg-surface/60 p-4">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
        Line-up
      </h3>
      <ul className="mt-3 space-y-2">
        {MODELS.map((m) => (
          <li key={m.id} className="flex items-center gap-2.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: PROVIDER_ACCENT[m.provider] }}
            />
            <span className="text-[13px] text-ink">{m.label}</span>
            <span className="ml-auto font-mono text-[11px] text-faint">
              {PROVIDER_LABEL[m.provider]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProgressBar({
  status,
  completed,
  total,
  elapsed,
  topError,
}: {
  status: RunStatus;
  completed: number;
  total: number;
  elapsed: number;
  topError: string | null;
}) {
  if (status === "idle" && completed === 0 && !topError) return null;
  const ratio = total > 0 ? completed / total : 0;
  const secs = (elapsed / 1000).toFixed(1);

  return (
    <div className="mb-8" aria-live="polite">
      <div className="flex items-center justify-between text-[12px]">
        <span className="font-mono uppercase tracking-[0.16em] text-muted">
          {status === "running"
            ? "Running"
            : status === "done"
              ? "Complete"
              : status === "error"
                ? "Error"
                : "Idle"}
        </span>
        <span className="font-mono tabular-nums text-faint">
          {completed}/{total} · {secs}s
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-hairline">
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-300 ease-out"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      {topError && (
        <p className="mt-3 rounded-md border border-signal/40 bg-signal/5 px-3 py-2 font-mono text-[12px] text-signal">
          {topError}
        </p>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-hairline bg-surface/40 px-6 py-16 text-center">
      <p className="font-display text-2xl text-ink">Nothing measured yet</p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        Set your runs and temperature, then run the benchmark. Jokes stream into
        the matrix as each call returns.
      </p>
    </div>
  );
}

function SectionTitle({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-12 border-t border-hairline pt-6 first:mt-0">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[12px] tabular-nums text-faint">
          {index}
        </span>
        <h2 className="font-display text-2xl text-ink">{title}</h2>
      </div>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">
        {children}
      </p>
    </div>
  );
}

type ModelData = {
  model: { provider: Provider; id: string; label: string };
  cells: Cell[];
  dups: Map<number, DuplicateInfo>;
  groupRuns: Map<number, number[]>;
  uniq: number | null;
  jac: number | null;
  verdict: ReturnType<typeof verdictFor>;
  errors: number;
  doneCount: number;
  avgLatency: number | null;
};

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-hairline">
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }}
      />
    </div>
  );
}

function Fingerprint({ data, runs }: { data: ModelData; runs: number }) {
  return (
    <div className="flex flex-wrap gap-1" aria-hidden>
      {Array.from({ length: runs }).map((_, r) => {
        const cell = data.cells[r] ?? { status: "pending" as const };
        const dup = data.dups.get(r);
        let style: React.CSSProperties = {};
        let cls = "h-3.5 w-3.5 rounded-[3px] border ";
        if (cell.status === "pending") {
          cls += "border-hairline bg-transparent";
        } else if (cell.status === "error") {
          cls += "border-signal/50 bg-signal/15";
        } else if (dup) {
          cls += "border-transparent";
          style = { background: dup.color };
        } else {
          cls += "border-hairline bg-ink/10"; // unique
        }
        return <span key={r} className={cls} style={style} />;
      })}
    </div>
  );
}

function AnalyticsCard({ data, runs }: { data: ModelData; runs: number }) {
  const accent = PROVIDER_ACCENT[data.model.provider];
  const v = data.verdict;
  return (
    <div className="animate-fadeUp rounded-xl border border-hairline bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: accent }}
          />
          <div>
            <p className="text-sm font-semibold leading-tight text-ink">
              {data.model.label}
            </p>
            <p className="font-mono text-[10px] text-faint">
              {PROVIDER_LABEL[data.model.provider]}
            </p>
          </div>
        </div>
        {v && (
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide"
            style={{ color: VERDICT_COLOR[v.tone], background: `${VERDICT_COLOR[v.tone]}14` }}
          >
            {v.label}
          </span>
        )}
      </div>

      <div className="mt-5">
        <div className="flex items-end justify-between">
          <span className="text-[12px] text-muted">Unique joke ratio</span>
          <span className="font-mono text-2xl tabular-nums text-ink">
            {data.uniq === null ? "—" : pct(data.uniq)}
          </span>
        </div>
        <div className="mt-2">
          <Bar value={data.uniq ?? 0} color={accent} />
        </div>
        <p className="mt-1.5 font-mono text-[10px] text-faint">
          {data.doneCount > 0
            ? `${new Set(
                data.cells
                  .filter((c) => c.status === "done" && c.joke)
                  .map((c) => (c.joke as string).trim()),
              ).size} distinct of ${data.doneCount}`
            : "awaiting output"}
        </p>
      </div>

      <div className="mt-4">
        <div className="flex items-end justify-between">
          <span className="text-[12px] text-muted">Consecutive Jaccard</span>
          <span className="font-mono text-2xl tabular-nums text-ink">
            {data.jac === null ? "—" : data.jac.toFixed(2)}
          </span>
        </div>
        <div className="mt-2">
          {/* invert: a full bar = highly similar (bad), so colour it as warning */}
          <Bar value={data.jac ?? 0} color="#C08A2B" />
        </div>
        <p className="mt-1.5 font-mono text-[10px] text-faint">
          token overlap between runs · lower is more diverse
        </p>
      </div>

      <div className="mt-5 border-t border-hairline pt-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            Repetition map
          </span>
          <span className="font-mono text-[10px] text-faint tabular-nums">
            {data.avgLatency !== null ? `${data.avgLatency}ms avg` : ""}
            {data.errors > 0 ? ` · ${data.errors} err` : ""}
          </span>
        </div>
        <div className="mt-2.5">
          <Fingerprint data={data} runs={runs} />
        </div>
      </div>
    </div>
  );
}

function JokeCell({
  cell,
  dup,
  groupRuns,
}: {
  cell: Cell;
  dup?: DuplicateInfo;
  groupRuns?: number[];
}) {
  if (cell.status === "pending") {
    return (
      <div className="flex h-full min-h-[92px] items-center">
        <div className="shimmer-bg h-3 w-3/4 animate-shimmer rounded-full" />
      </div>
    );
  }

  if (cell.status === "error") {
    return (
      <div className="flex h-full min-h-[92px] flex-col justify-center rounded-md border border-signal/30 bg-signal/5 p-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-signal">
          error
        </span>
        <span
          className="mt-1 line-clamp-3 font-mono text-[11px] leading-snug text-signal/90"
          title={cell.error}
        >
          {cell.error}
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-[92px] flex-col justify-between rounded-md p-2.5 transition"
      style={
        dup
          ? {
              background: `${dup.color}1f`,
              boxShadow: `inset 3px 0 0 ${dup.color}`,
            }
          : undefined
      }
    >
      <p className="font-mono text-[12px] leading-snug text-ink">{cell.joke}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-[10px] text-faint tabular-nums">
          {cell.latencyMs != null ? `${cell.latencyMs}ms` : ""}
        </span>
        {dup && (
          <span
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide"
            style={{ background: `${dup.color}33`, color: "#54493b" }}
            title={
              groupRuns && groupRuns.length
                ? `Identical to run ${groupRuns.map((r) => r + 1).join(", ")}`
                : undefined
            }
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: dup.color }}
            />
            dup ×{dup.size}
          </span>
        )}
      </div>
    </div>
  );
}

function Matrix({
  perModel,
  runs,
}: {
  perModel: ModelData[];
  runs: number;
}) {
  return (
    <div className="mt-5 overflow-x-auto">
      <div className="min-w-[640px]">
        {/* header row */}
        <div
          className="grid items-stretch gap-px overflow-hidden rounded-t-xl border border-hairline bg-hairline"
          style={{
            gridTemplateColumns: `56px repeat(${perModel.length}, minmax(0,1fr))`,
          }}
        >
          <div className="bg-surface px-3 py-3" />
          {perModel.map((m) => (
            <div
              key={m.model.id}
              className="flex items-center gap-2 bg-surface px-3 py-3"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: PROVIDER_ACCENT[m.model.provider] }}
              />
              <span className="text-[13px] font-semibold text-ink">
                {m.model.label}
              </span>
            </div>
          ))}
        </div>

        {/* run rows */}
        <div className="overflow-hidden rounded-b-xl border border-t-0 border-hairline">
          {Array.from({ length: runs }).map((_, r) => (
            <div
              key={r}
              className="grid items-stretch gap-px bg-hairline"
              style={{
                gridTemplateColumns: `56px repeat(${perModel.length}, minmax(0,1fr))`,
              }}
            >
              <div className="flex items-center justify-center bg-raised">
                <span className="font-mono text-[11px] tabular-nums text-faint">
                  {String(r + 1).padStart(2, "0")}
                </span>
              </div>
              {perModel.map((m) => {
                const cell = m.cells[r] ?? { status: "pending" as const };
                const dup = m.dups.get(r);
                const groupRuns = dup ? m.groupRuns.get(dup.groupId) : undefined;
                return (
                  <div key={m.model.id} className="bg-raised">
                    <JokeCell
                      cell={cell}
                      dup={dup}
                      groupRuns={groupRuns?.filter((x) => x !== r)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Definitions() {
  return (
    <section className="mt-12 border-t border-hairline pt-6">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
        How the scores work
      </h3>
      <dl className="mt-4 grid gap-x-8 gap-y-4 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="font-medium text-ink">Unique joke ratio</dt>
          <dd className="mt-1 leading-relaxed text-muted">
            Distinct exact strings ÷ total runs. 100% means every response was
            different; 20% over five runs means the same joke five times.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Consecutive Jaccard</dt>
          <dd className="mt-1 leading-relaxed text-muted">
            Average token-set overlap between run <em>i</em> and run{" "}
            <em>i+1</em>. 1.0 = identical wording each time, 0 = no shared
            words. Lower is more open-ended.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Duplicate tint</dt>
          <dd className="mt-1 leading-relaxed text-muted">
            Cells with a coloured edge share an exact string with another run.
            Each colour is one collapse group; the badge shows the group size.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">A caveat</dt>
          <dd className="mt-1 leading-relaxed text-muted">
            This measures diversity, not humour. Five different unfunny jokes
            still score as fully open-ended — see the write-up for where this
            approach holds up and where it doesn&rsquo;t.
          </dd>
        </div>
      </dl>
    </section>
  );
}
