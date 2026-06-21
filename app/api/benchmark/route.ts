import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import {
  MODELS, DEFAULT_PROMPT, RUNS_MIN, RUNS_MAX, TEMP_MIN, TEMP_MAX,
  clampTemp, type StreamMessage, type ModelSpec,
} from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function groqClient(): OpenAI {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  return new OpenAI({ apiKey: key, baseURL: "https://api.groq.com/openai/v1" });
}

function googleClient(): GoogleGenAI {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY is not set");
  return new GoogleGenAI({ apiKey: key });
}

async function callModel(model: ModelSpec, prompt: string, temperature: number): Promise<string> {
  const temp = clampTemp(model.provider, temperature);
  switch (model.provider) {
    case "groq": {
      const res = await groqClient().chat.completions.create({
        model: model.id, temperature: temp, max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });
      return (res.choices[0]?.message?.content ?? "").trim();
    }
    case "google": {
      const res = await googleClient().models.generateContent({
        model: model.id, contents: prompt,
        config: { temperature: temp, maxOutputTokens: 300 },
      });
      return (res.text ?? "").trim();
    }
    default:
      throw new Error(`Unknown provider: ${(model as ModelSpec).provider}`);
  }
}

function parseRequest(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const runs = Number.isFinite(Number(b.runs))
    ? Math.max(RUNS_MIN, Math.min(Math.floor(Number(b.runs)), RUNS_MAX)) : 5;
  const temperature = Number.isFinite(Number(b.temperature))
    ? Math.max(TEMP_MIN, Math.min(Number(b.temperature), TEMP_MAX)) : 1;
  const prompt = typeof b.prompt === "string" && b.prompt.trim().length > 0
    ? b.prompt : DEFAULT_PROMPT;
  return { runs, temperature, prompt };
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const { runs, temperature, prompt } = parseRequest(body);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (msg: StreamMessage) =>
        controller.enqueue(encoder.encode(JSON.stringify(msg) + "\n"));
      send({ type: "meta", runs, temperature, totalCells: MODELS.length * runs });
      for (const model of MODELS) {
        for (let run = 0; run < runs; run++) {
          const started = Date.now();
          try {
            const joke = await callModel(model, prompt, temperature);
            send({ type: "result", provider: model.provider, modelId: model.id, run, joke, latencyMs: Date.now() - started });
          } catch (err) {
            send({ type: "error", provider: model.provider, modelId: model.id, run, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - started });
          }
        }
      }
      send({ type: "done" });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}