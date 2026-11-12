import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiConfig, chat, chatJson, parseJson } from "@/lib/ai";

const KEYS = ["AI_PROVIDER", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_API_VERSION", "OLLAMA_BASE_URL", "OLLAMA_MODEL"];
const saved: Record<string, string | undefined> = {};
const fetchMock = vi.fn();

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k];
  else process.env[k] = saved[k];
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const reply = (body: unknown, status = 200) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("aiConfig", () => {
  it("is disabled by default", () => {
    expect(aiConfig()).toEqual({ provider: "none", model: "", enabled: false });
  });
  it("needs the key for the chosen provider", () => {
    process.env.AI_PROVIDER = "anthropic";
    expect(aiConfig().enabled).toBe(false);
    process.env.ANTHROPIC_API_KEY = "k";
    expect(aiConfig()).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5", enabled: true });
  });
  it("reads model overrides and Azure settings", () => {
    process.env.AI_PROVIDER = "OpenAI";
    process.env.OPENAI_API_KEY = "k";
    process.env.OPENAI_MODEL = "gpt-x";
    expect(aiConfig()).toMatchObject({ provider: "openai", model: "gpt-x", enabled: true });
    process.env.AI_PROVIDER = "azure";
    process.env.AZURE_OPENAI_API_KEY = "k";
    expect(aiConfig().enabled).toBe(false);
    process.env.AZURE_OPENAI_ENDPOINT = "https://x.openai.azure.com";
    process.env.AZURE_OPENAI_DEPLOYMENT = "dep";
    expect(aiConfig()).toMatchObject({ model: "dep", enabled: true });
  });
  it("ollama needs no key", () => {
    process.env.AI_PROVIDER = "ollama";
    expect(aiConfig()).toMatchObject({ model: "llama3.1", enabled: true });
  });
});

describe("chat – provider requests", () => {
  it("throws when AI is not configured", async () => {
    await expect(chat("s", "u")).rejects.toThrow(/not configured/);
  });

  it("Anthropic: correct URL, headers and body", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    reply({ content: [{ text: "hello" }, { text: " world" }] });
    expect(await chat("sys", "usr", { json: true, maxTokens: 10 })).toBe("hello world");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "sk-ant", "anthropic-version": "2023-06-01" });
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 10, messages: [{ role: "user", content: "usr" }] });
    expect(body.system).toMatch(/^sys[\s\S]*JSON/);
  });

  it("OpenAI: bearer token and JSON response format", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-oa";
    reply({ choices: [{ message: { content: "{}" } }] });
    expect(await chat("s", "u", { json: true })).toBe("{}");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer sk-oa");
    expect(JSON.parse(init.body)).toMatchObject({ model: "gpt-4o-mini", response_format: { type: "json_object" } });
  });

  it("Azure OpenAI: deployment URL and api-key header", async () => {
    Object.assign(process.env, { AI_PROVIDER: "azure", AZURE_OPENAI_API_KEY: "az", AZURE_OPENAI_ENDPOINT: "https://r.openai.azure.com/", AZURE_OPENAI_DEPLOYMENT: "gpt4o" });
    reply({ choices: [{ message: { content: "ok" } }] });
    await chat("s", "u");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://r.openai.azure.com/openai/deployments/gpt4o/chat/completions?api-version=2024-10-21");
    expect(init.headers["api-key"]).toBe("az");
    expect(JSON.parse(init.body).model).toBeUndefined();
  });

  it("Ollama: local chat endpoint with format=json", async () => {
    Object.assign(process.env, { AI_PROVIDER: "ollama", OLLAMA_BASE_URL: "http://gpu:11434/" });
    reply({ message: { content: "ok" } });
    expect(await chat("s", "u", { json: true })).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://gpu:11434/api/chat");
    expect(JSON.parse(init.body)).toMatchObject({ stream: false, format: "json" });
  });

  it("surfaces HTTP errors", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "k";
    reply({ error: "bad key" }, 401);
    await expect(chat("s", "u")).rejects.toThrow(/AI request failed \(401\)/);
  });

  it("chatJson parses the model's JSON", async () => {
    process.env.AI_PROVIDER = "ollama";
    reply({ message: { content: '```json\n{"a":1}\n```' } });
    expect(await chatJson("s", "u")).toEqual({ a: 1 });
  });
});

describe("parseJson", () => {
  it("parses plain, fenced and wrapped JSON", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJson('Here you go: {"a":3} thanks')).toEqual({ a: 3 });
  });
  it("throws on non-JSON", () => {
    expect(() => parseJson("no json here")).toThrow(/valid JSON/);
  });
});
