import { afterEach, describe, expect, it, vi } from "vitest";
import { explainStatus, fetchJson } from "@/lib/http";

const fetchMock = vi.fn();
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});
const stub = (body: string, status: number, type: string) => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(body, { status, headers: { "content-type": type } }));
};

describe("fetchJson", () => {
  it("returns parsed JSON for success and API errors", async () => {
    stub('{"a":1}', 200, "application/json");
    expect(await fetchJson("/x")).toEqual({ ok: true, status: 200, data: { a: 1 } });
    stub('{"error":"bad"}', 400, "application/json");
    expect(await fetchJson("/x")).toEqual({ ok: false, status: 400, data: { error: "bad" } });
  });

  it("explains an HTML error page instead of 'Unexpected token <'", async () => {
    stub("<!DOCTYPE html><html>An error occurred FUNCTION_INVOCATION_FAILED</html>", 500, "text/html");
    await expect(fetchJson("/api/compare")).rejects.toThrow(/server hit an error \(500\).*Logs/);
  });

  it("explains a host timeout", async () => {
    stub("<!DOCTYPE html>FUNCTION_INVOCATION_TIMEOUT", 504, "text/html");
    await expect(fetchJson("/api/compare")).rejects.toThrow(/took too long/);
  });

  it("explains network failures", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchJson("/x")).rejects.toThrow(/Could not reach the app server/);
  });

  it("handles invalid JSON with a JSON content type", async () => {
    stub("{oops", 502, "application/json");
    await expect(fetchJson("/x")).rejects.toThrow(/server hit an error \(502\)/);
  });
});

describe("explainStatus", () => {
  it.each([
    [504, "", /took too long/],
    [200, "FUNCTION_INVOCATION_TIMEOUT", /took too long/],
    [413, "", /too large/],
    [401, "", /Not signed in/],
    [404, "", /Root Directory/],
    [500, "", /server hit an error/],
    [418, "", /Unexpected response from the server \(418\)/],
  ])("%i %s", (status, body, re) => {
    expect(explainStatus(status, body)).toMatch(re);
  });
});
