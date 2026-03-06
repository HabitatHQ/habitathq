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
