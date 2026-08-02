//! Identity seam — how Atrium turns a request into an authenticated user.
//!
//! Atrium is identity-vendor-agnostic: it defines [`IdentityProvider`] and ships
//! a dev implementation ([`DevBearerProvider`]) so the whole stack can be
//! exercised without Clerk. A real `ClerkProvider` (JWKS verification) is a later
//! implementation of the same trait — no ACL rework (`D13`).

use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};

use crate::{error::AtriumError, state::AtriumState};

/// An authenticated user identifier (Clerk `sub`, or a dev token).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserId(String);

impl UserId {
    /// Build a `UserId` from a raw string.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// The user id as a string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Derives the authenticated [`UserId`] for a request, or rejects it.
pub trait IdentityProvider: Send + Sync + 'static {
    /// Authenticate `parts`, returning the caller's id.
    ///
    /// # Errors
    /// Returns [`AtriumError::Unauthorized`] when the request has no valid
    /// credential.
    fn authenticate(&self, parts: &Parts) -> Result<UserId, AtriumError>;
}

/// Dev identity: treats `Authorization: Bearer <user_id>` as the user id.
///
/// A stand-in for real JWT verification so the tenancy + ACL model can be
/// validated end-to-end without an auth vendor.
#[derive(Debug, Clone, Default)]
pub struct DevBearerProvider;

impl IdentityProvider for DevBearerProvider {
    fn authenticate(&self, parts: &Parts) -> Result<UserId, AtriumError> {
        parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(UserId::new)
            .ok_or_else(|| AtriumError::Unauthorized("missing or malformed bearer token".to_owned()))
    }
}

/// Axum extractor yielding the authenticated caller by invoking the
/// [`IdentityProvider`] in [`AtriumState`]. A rejection short-circuits with `401`.
#[derive(Debug, Clone)]
pub struct Caller(pub UserId);

// axum-core 0.4's `FromRequestParts` is an `#[async_trait]`, so the impl must
// use the same macro rather than a native `async fn`.
#[axum::async_trait]
impl FromRequestParts<AtriumState> for Caller {
    type Rejection = AtriumError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AtriumState,
    ) -> Result<Self, Self::Rejection> {
        state.identity().authenticate(parts).map(Caller)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::{DevBearerProvider, IdentityProvider};
    use axum::http::{header::AUTHORIZATION, request::Parts, Request};

    fn parts_with(auth: Option<&str>) -> Parts {
        let mut builder = Request::builder().uri("/");
        if let Some(a) = auth {
            builder = builder.header(AUTHORIZATION, a);
        }
        builder.body(()).unwrap().into_parts().0
    }

    #[test]
    fn dev_bearer_maps_token_to_user() {
        let id = DevBearerProvider
            .authenticate(&parts_with(Some("Bearer alice")))
            .unwrap();
        assert_eq!(id.as_str(), "alice");
    }

    #[test]
    fn dev_bearer_rejects_missing_or_malformed() {
        assert!(DevBearerProvider.authenticate(&parts_with(None)).is_err());
        assert!(DevBearerProvider
            .authenticate(&parts_with(Some("Basic xyz")))
            .is_err());
        assert!(DevBearerProvider
            .authenticate(&parts_with(Some("Bearer   ")))
            .is_err());
    }
}
