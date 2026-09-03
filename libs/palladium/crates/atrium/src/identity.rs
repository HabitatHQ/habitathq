//! Identity seam — how Atrium turns a request into an authenticated user.
//!
//! Atrium is identity-vendor-agnostic: it defines [`IdentityProvider`] and ships
//! a dev implementation ([`DevBearerProvider`]) so the whole stack can be
//! exercised without Clerk. A real `ClerkProvider` (JWKS verification) is a later
//! implementation of the same trait — no ACL rework (`D13`).

use crate::{error::AtriumError, state::AtriumState};
use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::collections::HashMap;

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

// TODO(clerk): add a `ClerkProvider` implementing `IdentityProvider` by
// verifying a Clerk session JWT against the instance JWKS (RS256): fetch + cache
// the JWKS (background refresh so `authenticate` stays synchronous, or make the
// trait async), check `exp`/`iss`/`azp`, and return `UserId(claims.sub)`. It
// slots in behind the same seam — no ACL or route changes. Wire it in `main.rs`
// behind a `--auth clerk` flag (env: CLERK_JWKS_URL / CLERK_ISSUER). Until then
// `DevBearerProvider` simulates the token (the bearer *is* the user id).

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
            .ok_or_else(|| {
                AtriumError::Unauthorized("missing or malformed bearer token".to_owned())
            })
    }
}
/// Verified JWT identity backed by a startup-fetched JWKS document.
#[derive(Clone)]
pub struct JwtJwksProvider {
    keys: HashMap<String, DecodingKey>,
    issuer: String,
    audience: String,
}

#[derive(Debug, Deserialize)]
struct JwkSet {
    keys: Vec<Jwk>,
}

#[derive(Debug, Deserialize)]
struct Jwk {
    kid: String,
    kty: String,
    n: String,
    e: String,
}

#[derive(Debug, Deserialize)]
struct Claims {
    sub: String,
}

impl JwtJwksProvider {
    /// Fetch and validate a JWKS source before serving requests.
    ///
    /// # Errors
    ///
    /// Returns an error when the JWKS URL is insecure, unavailable, or contains
    /// no usable RSA verification keys.
    pub async fn from_config(
        issuer: impl Into<String>,
        audience: impl Into<String>,
        jwks_url: &str,
    ) -> Result<Self, AtriumError> {
        if !jwks_url.starts_with("https://") {
            return Err(AtriumError::BadRequest(
                "JWKS URL must use HTTPS".to_owned(),
            ));
        }
        let response = reqwest::get(jwks_url)
            .await
            .map_err(AtriumError::internal)?
            .error_for_status()
            .map_err(AtriumError::internal)?;
        let set = response
            .json::<JwkSet>()
            .await
            .map_err(AtriumError::internal)?;
        let mut keys = HashMap::new();
        for jwk in set.keys {
            if jwk.kty != "RSA" {
                continue;
            }
            let key =
                DecodingKey::from_rsa_components(&jwk.n, &jwk.e).map_err(AtriumError::internal)?;
            keys.insert(jwk.kid, key);
        }
        if keys.is_empty() {
            return Err(AtriumError::internal(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "JWKS contains no RSA keys",
            )));
        }
        Ok(Self {
            keys,
            issuer: issuer.into(),
            audience: audience.into(),
        })
    }
}

impl IdentityProvider for JwtJwksProvider {
    fn authenticate(&self, parts: &Parts) -> Result<UserId, AtriumError> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AtriumError::Unauthorized("missing bearer token".to_owned()))?;
        let header = decode_header(token)
            .map_err(|_| AtriumError::Unauthorized("invalid JWT".to_owned()))?;
        if header.alg != Algorithm::RS256 {
            return Err(AtriumError::Unauthorized(
                "unsupported JWT algorithm".to_owned(),
            ));
        }
        let kid = header
            .kid
            .ok_or_else(|| AtriumError::Unauthorized("JWT is missing kid".to_owned()))?;
        let key = self
            .keys
            .get(&kid)
            .ok_or_else(|| AtriumError::Unauthorized("unknown JWT key".to_owned()))?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.validate_nbf = true;
        validation.set_issuer(&[self.issuer.as_str()]);
        validation.set_audience(&[self.audience.as_str()]);
        let token = decode::<Claims>(token, key, &validation)
            .map_err(|_| AtriumError::Unauthorized("invalid JWT".to_owned()))?;
        if token.claims.sub.trim().is_empty() {
            return Err(AtriumError::Unauthorized("JWT subject is empty".to_owned()));
        }
        Ok(UserId::new(token.claims.sub))
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
    use super::{DevBearerProvider, IdentityProvider, JwtJwksProvider};
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

    #[tokio::test]
    async fn jwt_provider_rejects_a_non_https_jwks_source() {
        assert!(JwtJwksProvider::from_config(
            "https://issuer.example",
            "atrium",
            "http://jwks.example"
        )
        .await
        .is_err());
    }
}
