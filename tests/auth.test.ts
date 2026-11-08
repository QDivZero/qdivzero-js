import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { createQDivZeroClient } from "../src/client.js";

function startServer(
  handler: (
    req: import("node:http").IncomingMessage,
  ) => [number, string, Record<string, string | string[]>?],
) {
  const server = createServer(async (req, res) => {
    const [status, body, headers] = handler(req);
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(body);
  });
  server.listen(0);
  return server;
}

function session(access: string, refresh: string): Record<string, string[]> {
  return {
    "set-cookie": [
      `qdiv0_access=${access}; Path=/`,
      `qdiv0_refresh=${refresh}; Path=/v1/auth/refresh`,
    ],
  };
}

async function waitForServer(s: Server): Promise<string> {
  return new Promise((resolve) =>
    s.once("listening", () =>
      resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`),
    ),
  );
}

describe("auth client", () => {
  it("sends the API key as Authorization: Bearer", async () => {
    let seen = "";
    const server = startServer((req) => {
      seen = req.headers.authorization ?? "";
      return [200, "{}"];
    });
    const baseUrl = await waitForServer(server);
    const client = createQDivZeroClient({
      baseUrl,
      apiKey: "k-123",
      loadCredentialsFile: false,
    });
    await client.GET("/v1/auth/me");
    expect(seen).toBe("Bearer k-123");
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    let refreshCalls = 0;
    let meCalls = 0;
    const server = startServer((req) => {
      if (req.url?.startsWith("/v1/auth/refresh")) {
        refreshCalls++;
        return [200, "{}", session("new-token", "r2")];
      }
      if (req.url === "/v1/auth/me") {
        meCalls++;
        const cookie = req.headers.cookie ?? "";
        return cookie.includes("qdiv0_access=new-token")
          ? [200, "{}"]
          : [401, "{}"];
      }
      return [404, "{}"];
    });
    const baseUrl = await waitForServer(server);
    const client = createQDivZeroClient({
      baseUrl,
      accessToken: "stale",
      refreshToken: "r1",
      loadCredentialsFile: false,
    });
    const { response } = await client.GET("/v1/auth/me");
    expect(response.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(meCalls).toBe(2);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("does not refresh for /auth/login failures", async () => {
    let refreshCalls = 0;
    const server = startServer((req) => {
      if (req.url?.startsWith("/v1/auth/refresh")) {
        refreshCalls++;
        return [500, "{}"];
      }
      if (req.url === "/v1/auth/login")
        return [401, JSON.stringify({ error: "bad credentials" })];
      return [404, "{}"];
    });
    const baseUrl = await waitForServer(server);
    const client = createQDivZeroClient({
      baseUrl,
      refreshToken: "r1",
      loadCredentialsFile: false,
    });
    await client.POST("/v1/auth/login", {
      body: { email: "a@b.c", password: "x" },
    });
    expect(refreshCalls).toBe(0);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("logs in on demand with credentials", async () => {
    let loginCalls = 0;
    const server = startServer((req) => {
      if (req.url === "/v1/auth/login") {
        loginCalls++;
        return [200, "{}", session("tok", "rr")];
      }
      if (req.url === "/v1/auth/me") {
        return req.headers.cookie?.includes("qdiv0_access=tok")
          ? [200, "{}"]
          : [401, "{}"];
      }
      return [404, "{}"];
    });
    const baseUrl = await waitForServer(server);
    const client = createQDivZeroClient({
      baseUrl,
      credentials: { email: "a@b.c", password: "p" },
      loadCredentialsFile: false,
    });
    const { response } = await client.GET("/v1/auth/me");
    expect(response.status).toBe(200);
    expect(loginCalls).toBe(1);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("retries a body-bearing request with the intact body", async () => {
    let refreshCalls = 0;
    let receivedBody = "";
    const server = startServer((req) => {
      if (req.url?.startsWith("/v1/auth/refresh")) {
        refreshCalls++;
        return [200, "{}", session("new-token", "r2")];
      }
      if (req.url === "/v1/accounts" && req.method === "POST") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          receivedBody = raw;
        });
        return req.headers.cookie?.includes("qdiv0_access=new-token")
          ? [201, "{}"]
          : [401, "{}"];
      }
      return [404, "{}"];
    });
    const baseUrl = await waitForServer(server);
    const client = createQDivZeroClient({
      baseUrl,
      accessToken: "stale",
      refreshToken: "r1",
      loadCredentialsFile: false,
    });
    const payload = JSON.stringify({ name: "acme" });
    const { response } = await client.POST("/v1/accounts", {
      body: JSON.parse(payload),
    });
    expect(response.status).toBe(201);
    expect(refreshCalls).toBe(1);
    expect(receivedBody).toBe(payload);
    await new Promise<void>((r) => server.close(() => r()));
  });
});
