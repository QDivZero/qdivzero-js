import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { TokenManager } from "../src/auth.js";

describe("session authentication", () => {
  it("sends the access cookie and keeps refresh cookies off other paths", () => {
    const manager = new TokenManager("https://api.example", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
    const request = new Request("https://api.example/v1/auth/me");
    manager.applyAuth(request);
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.headers.get("cookie")).toBe("qdiv0_access=access-1");
  });

  it("exchanges a refresh cookie and stores rotated cookies", async () => {
    let calls = 0;
    const seen: Array<[string | undefined, string | undefined]> = [];
    const server = createServer((req, res) => {
      calls++;
      seen.push([req.url, req.headers.cookie]);
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": [
          `qdiv0_access=access-${calls + 1}; Path=/; HttpOnly`,
          `qdiv0_refresh=refresh-${calls + 1}; Path=/v1/auth/refresh; HttpOnly`,
        ],
      });
      res.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const manager = new TokenManager(url, {
        accessToken: "access-1",
        refreshToken: "refresh-1",
      });
      await manager.refreshNow();
      await manager.refreshNow();
      expect(manager.token).toBe("access-3");
      expect(calls).toBe(2);
      expect(seen).toEqual([
        ["/v1/auth/refresh", "qdiv0_refresh=refresh-1"],
        ["/v1/auth/refresh", "qdiv0_refresh=refresh-2"],
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not send managed credentials to another origin", () => {
    const manager = new TokenManager("https://api.example", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
    const request = new Request("https://other.example/v1/auth/refresh");
    manager.applyAuth(request);
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.headers.get("cookie")).toBeNull();
  });

  it("does not replace a session with an expired cookie", () => {
    const manager = new TokenManager("https://api.example", {
      accessToken: "old-access",
      refreshToken: "old-refresh",
    });
    const headers = new Headers();
    headers.append("set-cookie", "qdiv0_access=expired; Max-Age=-1; Path=/");
    headers.append(
      "set-cookie",
      "qdiv0_refresh=new-refresh; Path=/v1/auth/refresh",
    );
    expect(manager.captureSession(new Response("{}", { headers }))).toBe(false);
    expect(manager.token).toBe("old-access");
  });

  it("uses explicit login even when an older session exists", async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.url ?? "");
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": [
          "qdiv0_access=new-access; Path=/; HttpOnly",
          "qdiv0_refresh=new-refresh; Path=/v1/auth/refresh; HttpOnly",
        ],
      });
      res.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const manager = new TokenManager(url, {
        accessToken: "old-access",
        refreshToken: "old-refresh",
      });
      await manager.login("user@example.com", "secret");
      expect(seen).toEqual(["/v1/auth/login"]);
      expect(manager.token).toBe("new-access");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects login responses requiring verification", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ next_step: "verify_email" }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const manager = new TokenManager(url);
      await expect(manager.login("user@example.com", "secret")).rejects.toThrow(
        "verify_email",
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("shares concurrent refresh attempts", async () => {
    let calls = 0;
    const server = createServer((_req, res) => {
      calls++;
      setTimeout(() => {
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": [
            "qdiv0_access=new; Path=/",
            "qdiv0_refresh=next; Path=/v1/auth/refresh",
          ],
        });
        res.end("{}");
      }, 30);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const manager = new TokenManager(url, {
        accessToken: "old",
        refreshToken: "r1",
      });
      await Promise.all([manager.refreshNow("old"), manager.refreshNow("old")]);
      await manager.refreshNow("old");
      expect(calls).toBe(1);
      expect(manager.token).toBe("new");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
