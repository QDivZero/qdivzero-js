import createClient from "openapi-fetch";
import type { paths } from "./generated/types.js";
import { authMiddleware, TokenManager } from "./auth.js";
import { loadCredentials } from "./credentials.js";

export interface QDivZeroClientOptions {
  baseUrl?: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  credentials?: { email: string; password: string };
  loadCredentialsFile?: boolean;
}

type ClientMethods = ReturnType<typeof createClient<paths>>;

export interface QDivZeroClient {
  GET: ClientMethods["GET"];
  POST: ClientMethods["POST"];
  PUT: ClientMethods["PUT"];
  PATCH: ClientMethods["PATCH"];
  DELETE: ClientMethods["DELETE"];
  login(email: string, password: string): Promise<void>;
  refresh(): Promise<void>;
}

export function createQDivZeroClient(
  opts: QDivZeroClientOptions = {},
): QDivZeroClient & ReturnType<typeof createClient<paths>> {
  const baseUrl = opts.baseUrl ?? "https://api.qdiv0.com";
  const file = opts.loadCredentialsFile === false ? null : loadCredentials();
  const authOpts = {
    apiKey: opts.apiKey ?? file?.apiKey,
    accessToken: opts.accessToken ?? file?.accessToken,
    refreshToken: opts.refreshToken ?? file?.refreshToken,
    email: opts.credentials?.email ?? file?.email,
    password: opts.credentials?.password ?? file?.password,
  };
  const manager = new TokenManager(baseUrl, authOpts);
  const client = createClient<paths>({ baseUrl });
  client.use(authMiddleware(manager));
  const wrapped = client as QDivZeroClient &
    ReturnType<typeof createClient<paths>>;
  wrapped.login = async (email: string, password: string) => {
    manager.apply({ email, password });
    await manager.refreshNow();
  };
  wrapped.refresh = async () => {
    await manager.refreshNow();
  };
  return wrapped;
}
