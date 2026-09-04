# Palladium

> Local-first sync engine — Rust backend, TypeScript frontend.

## Packages

| Package | Description |
|---|---|
| `@palladium/core` | Framework-agnostic TS client |
| `@palladium/react` | React bindings |
| `@palladium/vue` | Vue bindings |
| `@palladium/svelte` | Svelte bindings |
| `@palladium/kysely` | Kysely integration |
| `@palladium/vite-plugin` | Vite plugin (COOP/COEP + WASM) |
| `palladium-cli` | npm shim for the Rust CLI |

## Prerequisites

- [mise](https://mise.jdx.dev/) or Node 24 + pnpm 9 + Rust stable
- [`just`](https://just.systems/)

```sh
mise install        # installs node, pnpm, rust, just, cargo tools
pnpm install
```

## Development

```sh
just lint           # lint everything
just test           # test everything
just fmt            # format everything
just ci             # full CI check
```

## Local Authentik OIDC

The reproducible local identity-provider stack lives in
`crates/atrium/authentik/`. It follows Authentik's PostgreSQL Compose
topology and pins both Authentik services to `2026.8.1`. Published ports are
bound to loopback only; the named volumes are local development state and
must not be copied into source control.

```sh
cd libs/palladium/crates/atrium/authentik
cp .env.example .env
# Replace PG_PASS and AUTHENTIK_SECRET_KEY in .env with local random values.
docker compose config
docker compose pull
docker compose up -d
docker compose ps
```

Open `http://127.0.0.1:9000/if/flow/initial-setup/` (including the trailing
slash) to create the first local administrator. The worker discovers
`blueprints/atrium-oidc.yaml` automatically and creates the public
`atrium-local` OIDC provider plus the `atrium` application. Public browser
clients use authorization code with PKCE and therefore do not have a client
secret.

Use the values in `.env` for Atrium's OIDC configuration. In particular, the
per-provider issuer is
`http://127.0.0.1:9000/application/o/atrium/`, its discovery document is under
that path at `.well-known/openid-configuration`, and its JWKS endpoint is
`jwks/`. The loopback HTTP endpoints are intentionally suitable only for local
development; production requires an HTTPS issuer.
