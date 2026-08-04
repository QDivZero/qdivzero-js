import type { Middleware } from "openapi-fetch";

export interface AuthOptions {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  email?: string;
  password?: string;
  rawAuth?: string;
}

export class TokenManager {
  private apiKey = "";
  private accessToken = "";
  private refreshToken = "";
  private email = "";
  private password = "";
  private rawAuth = "";
  private refreshing: Promise<void> | null = null;

  constructor(
    private baseUrl: string,
    opts: AuthOptions = {},
  ) {
    this.apply(opts);
  }

  apply(opts: AuthOptions): void {
    if (opts.apiKey) this.apiKey = opts.apiKey;
    if (opts.accessToken) this.accessToken = opts.accessToken;
    if (opts.refreshToken) this.refreshToken = opts.refreshToken;
    if (opts.email) this.email = opts.email;
    if (opts.password) this.password = opts.password;
    if (opts.rawAuth) this.rawAuth = opts.rawAuth;
  }

  get token(): string {
    return this.accessToken;
  }

  applyAuth(request: Request): void {
    if (request.headers.has("Authorization")) return;
    if (this.rawAuth) request.headers.set("Authorization", this.rawAuth);
    else if (this.accessToken)
      request.headers.set("Authorization", `Bearer ${this.accessToken}`);
    else if (this.apiKey)
      request.headers.set("Authorization", `Bearer ${this.apiKey}`);
  }

  canRefresh(path: string): boolean {
    return (
      path !== "/auth/login" &&
      path !== "/auth/refresh" &&
      (this.refreshToken !== "" || (this.email !== "" && this.password !== ""))
    );
  }

  async refreshNow(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    if (this.refreshToken) {
      const res = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });
      if (!res.ok)
        throw new Error(`qdivzero: refresh token: status ${res.status}`);
      const body = (await res.json()) as { access_token?: string };
      if (!body.access_token)
        throw new Error("qdivzero: refresh token: empty access token");
      this.accessToken = body.access_token;
      return;
    }
    if (this.email && this.password) {
      const res = await fetch(`${this.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: this.email, password: this.password }),
      });
      if (!res.ok) throw new Error(`qdivzero: login: status ${res.status}`);
      const body = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
      };
      if (!body.access_token)
        throw new Error("qdivzero: login: empty access token");
      this.accessToken = body.access_token;
      if (body.refresh_token) this.refreshToken = body.refresh_token;
      return;
    }
    throw new Error("qdivzero: no refresh token or credentials available");
  }
}

export function authMiddleware(manager: TokenManager): Middleware {
  const sent = new WeakMap<Request, Request>();
  return {
    async onRequest({ request }) {
      // Cache a pristine clone BEFORE dispatch: cloning after the request is
      // sent throws "Body is unusable" for body-bearing requests.
      sent.set(request, request.clone());
      manager.applyAuth(request);
    },
    async onResponse({ request, response }) {
      if (
        response.status === 401 &&
        manager.canRefresh(new URL(request.url).pathname)
      ) {
        const original = sent.get(request);
        sent.delete(request);
        if (original) {
          await manager.refreshNow();
          original.headers.delete("Authorization"); // defensive: clone is pristine (taken before auth)
          manager.applyAuth(original);
          return fetch(original);
        }
      }
      sent.delete(request);
      return response;
    },
  };
}
