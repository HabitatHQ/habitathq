//! The [`AuthSeam`] — how the host derives an authenticated store [`Scope`].
//!
//! Palladium stays vendor- and domain-neutral: it defines this seam and calls
//! it on every scoped request, but ships only trivial in-repo implementations.
//! A real host (Atrium) implements [`AuthSeam`] to verify a token and map the
//! caller to the opaque scope they may touch. Clients never supply the scope
//! (`D11`/`D17`).

use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use palladium_core::Scope;
use serde_json::json;

use crate::state::AppState;

/// Rejection returned when a request cannot be authenticated → HTTP `401`.
#[derive(Debug)]
pub struct AuthRejection(String);

impl AuthRejection {
    /// Build a rejection with a human-readable reason.
    #[must_use]
    pub fn new(msg: impl Into<String>) -> Self {
        Self(msg.into())
    }
}

impl IntoResponse for AuthRejection {
    fn into_response(self) -> Response {
        (StatusCode::UNAUTHORIZED, Json(json!({ "error": self.0 }))).into_response()
    }
}

/// Derives the authenticated, opaque store [`Scope`] for a request.
///
/// The host maps an authenticated caller to the scope they may touch; Palladium
/// calls this on every scoped request and uses **only** the returned scope.
pub trait AuthSeam: Send + Sync + 'static {
    /// Authenticate `parts` and return the caller's scope, or reject (`401`).
    ///
    /// # Errors
    /// Returns [`AuthRejection`] when the request is not authenticated.
    fn authenticate(&self, parts: &Parts) -> Result<Scope, AuthRejection>;
}

/// A seam that ignores the request and always returns one fixed scope, making
/// the server single-tenant. This is the default (local/dev and tests).
#[derive(Debug, Clone)]
pub struct StaticScopeSeam(Scope);

impl StaticScopeSeam {
    /// Build a static seam that always yields `scope`.
    #[must_use]
    pub const fn new(scope: Scope) -> Self {
        Self(scope)
    }
}

impl Default for StaticScopeSeam {
    fn default() -> Self {
        Self(Scope::new("default"))
    }
}

impl AuthSeam for StaticScopeSeam {
    fn authenticate(&self, _parts: &Parts) -> Result<Scope, AuthRejection> {
        Ok(self.0.clone())
    }
}

/// A trivial seam that maps the `Authorization: Bearer <token>` header to
/// `Scope::new(<token>)`, rejecting requests without a bearer token.
///
/// It stands in for a real host seam (Atrium verifies a JWT and derives the
/// scope) so the seam can be exercised end-to-end without a vendor.
#[derive(Debug, Clone, Default)]
pub struct BearerTokenSeam;

impl AuthSeam for BearerTokenSeam {
    fn authenticate(&self, parts: &Parts) -> Result<Scope, AuthRejection> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| AuthRejection::new("missing or malformed bearer token"))?;
        Ok(Scope::new(token))
    }
}

/// Axum extractor yielding the authenticated [`Scope`] by invoking the
/// [`AuthSeam`] stored in [`AppState`]. A rejection short-circuits the handler
/// with `401` before the store is touched.
#[derive(Debug, Clone)]
pub struct AuthScope(pub Scope);

// axum-core 0.4's `FromRequestParts` is an `#[async_trait]`, so the impl must
// use the same macro rather than a native `async fn`.
#[axum::async_trait]
impl<S> FromRequestParts<AppState<S>> for AuthScope
where
    S: Send + Sync,
{
    type Rejection = AuthRejection;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState<S>,
    ) -> Result<Self, Self::Rejection> {
        state.auth.authenticate(parts).map(AuthScope)
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use axum::http::{header::AUTHORIZATION, Request};

    use super::{AuthSeam, BearerTokenSeam, StaticScopeSeam};

    fn parts_with(auth: Option<&str>) -> axum::http::request::Parts {
        let mut builder = Request::builder().uri("/");
        if let Some(a) = auth {
            builder = builder.header(AUTHORIZATION, a);
        }
        builder.body(()).unwrap().into_parts().0
    }

    #[test]
    fn static_seam_ignores_request_and_returns_fixed_scope() {
        let seam = StaticScopeSeam::default();
        let scope = seam.authenticate(&parts_with(None)).unwrap();
        assert_eq!(scope.as_str(), "default");
    }

    #[test]
    fn bearer_seam_maps_token_to_scope() {
        let seam = BearerTokenSeam;
        let scope = seam.authenticate(&parts_with(Some("Bearer alice"))).unwrap();
        assert_eq!(scope.as_str(), "alice");
    }

    #[test]
    fn bearer_seam_rejects_missing_token() {
        let seam = BearerTokenSeam;
        assert!(seam.authenticate(&parts_with(None)).is_err());
        assert!(seam.authenticate(&parts_with(Some("Basic xyz"))).is_err());
        assert!(seam.authenticate(&parts_with(Some("Bearer   "))).is_err());
    }
}
