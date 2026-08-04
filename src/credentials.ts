import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Credentials {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  apiKey: string;
}

const EMPTY: Credentials = {
  email: "",
  password: "",
  accessToken: "",
  refreshToken: "",
  apiKey: "",
};

export function credentialsPath(home?: string): string {
  return join(home ?? homedir(), ".qdivzero", "credentials");
}

export function loadCredentials(home?: string): Credentials {
  const path = credentialsPath(home);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY };
    throw new Error(`qdivzero: read credentials: ${(err as Error).message}`);
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, string>>;
    return {
      email: parsed.email ?? "",
      password: parsed.password ?? "",
      accessToken: parsed.access_token ?? "",
      refreshToken: parsed.refresh_token ?? "",
      apiKey: parsed.api_key ?? "",
    };
  } catch (err) {
    throw new Error(`qdivzero: parse credentials: ${(err as Error).message}`);
  }
}
