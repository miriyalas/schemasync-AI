/**
 * Provider-agnostic LLM client (Anthropic, OpenAI, Azure OpenAI, Ollama) using plain fetch.
 * Only schema metadata and SQL text are ever sent – never table data.
 */

export type AiProvider = "anthropic" | "openai" | "azure" | "ollama" | "none";

export function aiConfig() {
  const provider = (process.env.AI_PROVIDER || "none").toLowerCase() as AiProvider;
  const model =
    provider === "anthropic"
      ? process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5"
      : provider === "openai"
        ? process.env.OPENAI_MODEL || "gpt-4o-mini"
        : provider === "azure"
          ? process.env.AZURE_OPENAI_DEPLOYMENT || ""
          : provider === "ollama"
            ? process.env.OLLAMA_MODEL || "llama3.1"
            : "";
  const keyOk =
    provider === "anthropic"
      ? !!process.env.ANTHROPIC_API_KEY
      : provider === "openai"
        ? !!process.env.OPENAI_API_KEY
        : provider === "azure"
          ? !!(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT && model)
          : provider === "ollama";
  return { provider, model, enabled: provider !== "none" && keyOk };
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** Send a system + user prompt, return the model's text. */
export async function chat(system: string, user: string, opts: { json?: boolean; maxTokens?: number } = {}): Promise<string> {
  const { provider, model, enabled } = aiConfig();
  if (!enabled) throw new Error("AI is not configured. Set AI_PROVIDER and its API key.");
  const maxTokens = opts.maxTokens ?? 4000;

  if (provider === "anthropic") {
    const r = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      {
        model,
        max_tokens: maxTokens,
        system: opts.json ? `${system}\n\nRespond with a single valid JSON object only. No markdown, no prose.` : system,
        messages: [{ role: "user", content: user }],
      }
    );
    return (r.content || []).map((c: { text?: string }) => c.text || "").join("");
  }

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  if (provider === "openai" || provider === "azure") {
    const url =
      provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : `${process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/$/, "")}/openai/deployments/${model}/chat/completions?api-version=${
            process.env.AZURE_OPENAI_API_VERSION || "2024-10-21"
          }`;
    const headers: Record<string, string> =
      provider === "openai"
        ? { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
        : { "api-key": process.env.AZURE_OPENAI_API_KEY! };
    const r = await post(url, headers, {
      ...(provider === "openai" ? { model } : {}),
      messages,
      max_tokens: maxTokens,
      temperature: 0.1,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    });
    return r.choices?.[0]?.message?.content || "";
  }

  // ollama
  const r = await post(
    `${(process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "")}/api/chat`,
    {},
    { model, messages, stream: false, ...(opts.json ? { format: "json" } : {}), options: { temperature: 0.1 } }
  );
  return r.message?.content || "";
}

/** Parse JSON from a model reply, tolerating ```json fences or leading text. */
export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error("AI did not return valid JSON.");
  }
}

export async function chatJson<T>(system: string, user: string, maxTokens?: number): Promise<T> {
  return parseJson<T>(await chat(system, user, { json: true, maxTokens }));
}
