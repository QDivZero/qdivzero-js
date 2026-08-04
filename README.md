<p align="center">
  <img src="assets/qdiv0-mark.png" alt="QDivZero" width="256">
</p>

# qdivzero-js

TypeScript client for the QDivZero API, generated from its OpenAPI specification.

[![CI](https://github.com/QDivZero/qdivzero-js/actions/workflows/ci.yml/badge.svg)](https://github.com/QDivZero/qdivzero-js/actions/workflows/ci.yml)

## Install

The package is not published to npm yet; install directly from GitHub:

```sh
npm install git+https://github.com/QDivZero/qdivzero-js.git#v1.0.0
```

Requires Node.js >= 22.

## Quick start

```ts
import { createQDivZeroClient } from "@qdivzero/qdivzero-js";

const client = createQDivZeroClient({ apiKey: "your-api-key" });

const { data, error, response } = await client.GET("/accounts");
if (response.status !== 200) {
  console.error(`get accounts: status ${response.status}`, error);
  process.exit(1);
}
for (const m of data?.memberships ?? []) {
  console.log(`account=${m.account_id} role=${m.role}`);
}
```

Every operation is typed against the OpenAPI spec, so `data`, `error` and the
request paths are checked at compile time.

## Authentication

Tokens take precedence over API keys — the client sends the first available of:

1. An access token, set via `accessToken` or acquired through login/refresh
   (`Authorization: Bearer <token>`).
2. An API key, set via `apiKey` (`Authorization: Bearer <key>`).

The client accepts the following options:

- `apiKey` — authenticate with a QDivZero API key.
- `accessToken` / `refreshToken` — pre-configure bearer tokens without logging
  in.
- `credentials: { email, password }` — enable on-demand login when no refresh
  token is available.
- `baseUrl` — override the API base URL (defaults to `https://api.qdiv0.com`).

`client.login(email, password)` authenticates with credentials and stores the
access and refresh tokens. When a request fails with `401`, the client
transparently refreshes the access token (using the refresh token, or
re-logging in with stored credentials) and retries the request once. Concurrent
401s trigger a single shared refresh. `client.refresh()` forces a refresh.

## Credentials file

If `~/.qdivzero/credentials` exists, the client loads it automatically. All
fields are optional:

```json
{
  "email": "you@example.com",
  "password": "your-password",
  "access_token": "...",
  "refresh_token": "..."
}
```

`email`/`password` enable on-demand login; `access_token`/`refresh_token`
authenticate directly. Explicit client options override file values. Pass
`loadCredentialsFile: false` to disable auto-loading. Keep the file private
(`chmod 600 ~/.qdivzero/credentials`) and never commit it.

## Error handling

Operations return `{ data, error, response }` (openapi-fetch style): `response`
is the raw `Response`, `error` is the typed error body (or `undefined` when the
request succeeded), and `data` is the typed response body (or `undefined` when
it failed). Transport-level failures reject the promise.

## Regeneration

This library is regenerated automatically from the upstream spec
(`https://api.qdiv0.com/openapi`) by the CI update workflow (daily at 06:00
UTC, or manually via _Actions → Update → Run workflow_). The upstream spec
snapshot is committed at `api/openapi.json`.

**`src/generated/types.ts` is generated — do not edit it by hand.** A new
release tag (`v1.0.<n>`) is published on every change.

## Development

Regenerate locally:

```sh
npx openapi-typescript@7.13.0 api/openapi.json -o src/generated/types.ts
```

Checks: `npm run typecheck`, `npm test`, `npm run fmt-check`.
