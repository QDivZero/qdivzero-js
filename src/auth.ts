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
    this.baseUrl = baseUrl.replace(/\/+$/, "");
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
    const url = new URL(request.url);
    if (url.origin !== new URL(this.baseUrl).origin) return;
    if (!request.headers.has("Authorization")) {
      if (this.rawAuth) request.headers.set("Authorization", this.rawAuth);
      else if (this.accessToken)
        this.setCookie(request, "qdiv0_access", this.accessToken);
      else if (this.apiKey)
        request.headers.set("Authorization", `Bearer ${this.apiKey}`);
    }
    if (url.pathname.endsWith("/auth/refresh") && this.refreshToken) {
      this.setCookie(request, "qdiv0_refresh", this.refreshToken);
    }
  }

  private setCookie(request: Request, name: string, value: string): void {
    const parts = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && part.split("=", 1)[0] !== name);
    parts.push(`${name}=${value}`);
    request.headers.set("cookie", parts.join("; "));
  }

  canRefresh(url: string): boolean {
    const parsed = new URL(url);
    return (
      parsed.origin === new URL(this.baseUrl).origin &&
      !parsed.pathname.endsWith("/auth/login") &&
      !parsed.pathname.endsWith("/auth/refresh") &&
      (this.refreshToken !== "" || (this.email !== "" && this.password !== ""))
    );
  }

  async login(email: string, password: string): Promise<void> {
    if (this.refreshing) {
      try {
        await this.refreshing;
      } catch {
        // A new explicit login can recover from an earlier failed refresh.
      }
    }
    this.email = email;
    this.password = password;
    this.refreshing = this.doRefresh(true).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async refreshNow(sentAccess?: string): Promise<void> {
    if (
      sentAccess !== undefined &&
      this.accessToken &&
      this.accessToken !== sentAccess
    )
      return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh(false).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  captureSession(response: Response): boolean {
    if (
      response.url &&
      new URL(response.url).origin !== new URL(this.baseUrl).origin
    )
      return false;
    let access = "";
    let refresh = "";
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attributes] = raw.split(";");
      if (
        attributes.some((part) => {
          const match = /^\s*max-age\s*=\s*(-?\d+)\s*$/i.exec(part);
          return match !== null && Number(match[1]) <= 0;
        })
      )
        continue;
      const pos = pair.indexOf("=");
      if (pos < 0) continue;
      const name = pair.slice(0, pos).trim();
      const value = pair.slice(pos + 1).trim();
      if (name === "qdiv0_access") access = value;
      if (name === "qdiv0_refresh") refresh = value;
    }
    if (!access || !refresh) return false;
    this.accessToken = access;
    this.refreshToken = refresh;
    return true;
  }

  private async doRefresh(forceLogin: boolean): Promise<void> {
    if (this.refreshToken && !forceLogin) {
      const res = await fetch(`${this.baseUrl}/v1/auth/refresh`, {
        method: "POST",
        headers: { cookie: `qdiv0_refresh=${this.refreshToken}` },
        redirect: "manual",
      });
      if (res.status !== 200)
        throw new Error(`qdivzero: refresh token: status ${res.status}`);
      if (!this.captureSession(res))
        throw new Error("qdivzero: refresh token: missing session cookies");
      return;
    }
    if (this.email && this.password) {
      const res = await fetch(`${this.baseUrl}/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: this.email, password: this.password }),
        redirect: "manual",
      });
      if (res.status !== 200)
        throw new Error(`qdivzero: login: status ${res.status}`);
      if (!this.captureSession(res)) {
        const body = (await res.json().catch(() => ({}))) as {
          next_step?: string;
        };
        if (body.next_step)
          throw new Error(
            `qdivzero: login: verification required: ${body.next_step}`,
          );
        throw new Error("qdivzero: login: missing session cookies");
      }
      return;
    }
    throw new Error("qdivzero: no refresh token or credentials available");
  }
}

export function authMiddleware(manager: TokenManager): Middleware {
  const sent = new WeakMap<Request, { original: Request; access: string }>();
  return {
    async onRequest({ request }) {
      // Cache a pristine clone BEFORE dispatch: cloning after the request is
      // sent throws "Body is unusable" for body-bearing requests.
      sent.set(request, { original: request.clone(), access: manager.token });
      manager.applyAuth(request);
    },
    async onResponse({ request, response }) {
      const pathname = new URL(request.url).pathname;
      if (
        response.status === 200 &&
        (pathname.endsWith("/auth/login") || pathname.endsWith("/auth/refresh"))
      ) {
        manager.captureSession(response);
      }
      if (response.status === 401 && manager.canRefresh(request.url)) {
        const entry = sent.get(request);
        sent.delete(request);
        if (entry) {
          const { original, access } = entry;
          await manager.refreshNow(access);
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
