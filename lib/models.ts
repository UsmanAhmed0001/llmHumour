// Shared types + the single source of truth for which models we benchmark.
// Imported by BOTH the API route (server) and the dashboard (client) so the
// matrix layout and the execution loop can never drift apart.

export type Provider = "openai" | "anthropic" | "google" | "groq";

export interface ModelSpec {
  provider: Provider;
  /** Exact model id sent to the provider SDK. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
}

// All three models below are FREE (no credit card required):
//   Groq   → console.groq.com        (sign up → API Keys → Create)
//   Google → aistudio.google.com/apikey
export const MODELS: ModelSpec[] = [
  { provider: "groq",   id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B"    },
  { provider: "groq",   id: "llama-3.1-8b-instant",    label: "Llama 3.1 8B"     },
  { provider: "google", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

export const DEFAULT_PROMPT = "Tell me a joke.";

export const RUNS_MIN = 1;
export const RUNS_MAX = 20;
export const RUNS_DEFAULT = 5;

export const TEMP_MIN = 0;
export const TEMP_MAX = 2;
export const TEMP_DEFAULT = 1.0;
export const TEMP_STEP_NOTE = "0–2 scale. Groq and Google both accept 0–2.";

export const PROVIDER_TEMP_CAP: Record<Provider, number> = {
  openai: 2,
  anthropic: 1,
  google: 2,
  groq: 2,
};

export function clampTemp(provider: Provider, t: number): number {
  const cap = PROVIDER_TEMP_CAP[provider];
  return Math.max(0, Math.min(t, cap));
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  groq: "Groq",
};

export type StreamMessage =
  | { type: "meta"; runs: number; temperature: number; totalCells: number }
  | { type: "result"; provider: Provider; modelId: string; run: number; joke: string; latencyMs: number }
  | { type: "error";  provider: Provider; modelId: string; run: number; error: string; latencyMs: number }
  | { type: "done" };

export interface BenchmarkRequest {
  runs: number;
  temperature: number;
  prompt: string;
}