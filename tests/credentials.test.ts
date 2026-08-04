import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCredentials } from "../src/credentials.js";

describe("credentials file", () => {
  const homes = new Set<string>();
  afterEach(() => {
    for (const h of homes) rmSync(h, { recursive: true, force: true });
    homes.clear();
  });

  function withHome(content?: string): string {
    const home = join(tmpdir(), `qdivzero-test-${crypto.randomUUID()}`);
    mkdirSync(join(home, ".qdivzero"), { recursive: true });
    if (content !== undefined) writeFileSync(join(home, ".qdivzero", "credentials"), content);
    homes.add(home);
    return home;
  }

  it("loads tokens from ~/.qdivzero/credentials", () => {
    const home = withHome(JSON.stringify({ access_token: "t1", refresh_token: "r1" }));
    const creds = loadCredentials(home);
    expect(creds).toEqual({ email: "", password: "", accessToken: "t1", refreshToken: "r1" });
  });

  it("returns empty credentials when the file is missing", () => {
    const home = withHome();
    const creds = loadCredentials(home);
    expect(creds).toEqual({ email: "", password: "", accessToken: "", refreshToken: "" });
  });

  it("throws on a malformed file", () => {
    const home = withHome("not json");
    expect(() => loadCredentials(home)).toThrow();
  });
});
