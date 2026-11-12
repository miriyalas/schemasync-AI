import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const req = (auth?: string) => new NextRequest("http://localhost/results", { headers: auth ? { authorization: auth } : {} });
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;

afterEach(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.APP_USER;
});

describe("password protection middleware", () => {
  it("lets everything through when APP_PASSWORD is not set", () => {
    expect(middleware(req()).status).toBe(200);
  });
  it("asks for credentials when APP_PASSWORD is set", () => {
    process.env.APP_PASSWORD = "secret";
    const res = middleware(req());
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/Basic/);
  });
  it("accepts the right user and password (default user admin)", () => {
    process.env.APP_PASSWORD = "s:e:cret";
    expect(middleware(req(basic("admin", "s:e:cret"))).status).toBe(200);
  });
  it("uses APP_USER when set and rejects wrong credentials", () => {
    process.env.APP_PASSWORD = "secret";
    process.env.APP_USER = "dba";
    expect(middleware(req(basic("admin", "secret"))).status).toBe(401);
    expect(middleware(req(basic("dba", "wrong"))).status).toBe(401);
    expect(middleware(req(basic("dba", "secret"))).status).toBe(200);
    expect(middleware(req("Basic !!!notbase64")).status).toBe(401);
  });
});
