# Atrium Authentik OIDC integration

## Goal

Replace Burrow's preset bearer identities with Authentik OpenID Connect authentication, make Atrium validate Authentik-issued access tokens through discovery and JWKS, and provide reproducible local and containerized verification without committing credentials.

## Scope

1. **Atrium OIDC provider**
   - Replace startup-only `JwtJwksProvider` configuration with an OIDC discovery-backed provider.
   - Fetch and validate discovery metadata, require the configured issuer to match discovery, and use its `jwks_uri`.
   - Enforce RS256, `exp`, `nbf`, `iss`, configured client-id audience, and a nonempty `sub`.
   - Cache signing keys, refresh periodically and once for an unknown `kid`, and single-flight concurrent refreshes.
   - Return a typed retryable provider-unavailable response when refresh is required but the provider cannot be reached. A refreshed JWKS that still lacks the key remains a `401`.
   - Make authentication asynchronous so refresh is legal at the request boundary.
   - Make auth mode explicit: development bearer identity is loopback-only; OIDC requires issuer and audience and permits HTTP discovery/JWKS only with an explicit loopback-only development flag.

2. **Burrow OIDC client**
   - Use authorization-code plus PKCE through Authentik discovery.
   - Start sign-in only when the user enables sync; do not retain the preset-user picker or bearer-as-user behavior.
   - Use the authenticated `sub` for local store partitioning and attach the current access token to both Atrium control-plane calls and `SyncTransport` requests.
   - Clear/dispose the transport on sign-out and reject an expired/missing session rather than falling back to a fabricated identity.

3. **Local Compose environment**
   - Pin Authentik to `2026.8.1` with PostgreSQL, matching Authentik's official Compose topology.
   - Mount a versioned Authentik blueprint that configures a public OIDC PKCE application and asymmetric signing key.
   - Keep passwords, bootstrap tokens, client secrets, and deployment values in ignored `.env`; commit only `.env.example` placeholders and bootstrap commands.
   - Bind development endpoints to loopback. The Compose environment is for local development and integration verification—not production deployment.

4. **Testcontainers verification**
   - Start Authentik and its PostgreSQL dependency with Testcontainers, wait for the OIDC discovery document, obtain an Authentik-issued token, and call an authenticated Atrium route in OIDC mode.
   - Cover valid access, wrong issuer, wrong audience, expired token, missing bearer, and unknown-key refresh. The test must use Authentik's published discovery and JWKS documents, not a hand-rolled signer.
   - Gate Docker-dependent tests behind an explicit Cargo feature so ordinary crate tests remain deterministic and Docker-free; CI/local commands document the feature.

5. **Documentation**
   - Document required Authentik provider settings, issuer mode, discovery URL, redirect URI registration, local Compose startup, Atrium environment variables, and the Docker-dependent test command.
   - Replace stale Clerk/preset-user follow-up wording with the actual Authentik cutover.

## Verification order

1. Run `cargo test -p atrium --lib` for provider, route, and migration behavior.
2. Run the Docker-gated Authentik Testcontainers test against a real local Docker daemon.
3. Run `docker compose --env-file .env.example config` only with non-secret validation placeholders; start the stack using a local ignored `.env`.
4. Build Burrow with `pnpm --filter @palladium/example-burrow build`.
5. Run applicable Palladium lint and test commands, including `just lint` and `just test` after the focused checks pass.
6. Review the exact staged diff, commit distinct source/test/doc changes without bypassing hooks, update the feature branch, and merge it to `main` only after all checks succeed.

## Risks and decisions

- Browser clients are public clients: no client secret belongs in Burrow or a committed Compose file. Use PKCE.
- Authentik's provider-specific issuer must exactly equal the configured issuer. Its discovery endpoint remains under the provider slug even if global issuer mode is selected.
- HTTP OIDC/JWKS is allowed only for an explicitly selected loopback development configuration. Production requires HTTPS.
- JWKS refresh must be bounded; unknown `kid` requests cannot each trigger a network request.
- Authentik blueprint creation is atomic, but its discovery/apply timing is asynchronous. Tests must wait on the actual discovery endpoint, never a fixed sleep.
