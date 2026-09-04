//! Identity seam—how Atrium turns a request into an authenticated user.
//!
//! The development provider accepts a loopback-only bearer identity. The OIDC
//! provider validates Authentik-issued RS256 access tokens using discovery and
//! JWKS metadata.

use crate::{error::AtriumError, state::AtriumState};
use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
/// An authenticated user identifier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserId(String);
impl UserId {
    /// Build a user identifier from an authenticated subject.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
    /// Return the stable subject string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
/// Derives the authenticated user for a request.
#[axum::async_trait]
pub trait IdentityProvider: Send + Sync + 'static {
    /// Authenticate request headers.
    async fn authenticate(&self, parts: &Parts) -> Result<UserId, AtriumError>;
}
/// Development identity provider for loopback-only servers.
#[derive(Debug, Clone, Default)]
pub struct DevBearerProvider;
#[axum::async_trait]
impl IdentityProvider for DevBearerProvider {
    async fn authenticate(&self, parts: &Parts) -> Result<UserId, AtriumError> {
        parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(UserId::new)
            .ok_or_else(|| AtriumError::Unauthorized("missing or malformed bearer token".into()))
    }
}

/// OIDC provider that validates Authentik-issued JWTs against cached JWKS keys.
#[derive(Clone)]
pub struct JwtJwksProvider {
    client: reqwest::Client,
    jwks_url: String,
    issuer: String,
    audience: String,
    cache: Arc<Mutex<KeyCache>>,
    refresh_lock: Arc<Mutex<()>>,
}
struct KeyCache {
    keys: HashMap<String, DecodingKey>,
    refreshed: Instant,
}
#[derive(Debug, Deserialize)]
struct Discovery {
    issuer: String,
    jwks_uri: String,
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
    /// Create a provider from Authentik OIDC discovery metadata.
    ///
    /// # Errors
    ///
    /// Returns an error when discovery, issuer validation, or the initial JWKS
    /// fetch fails.
    pub async fn from_config(
        issuer: impl Into<String>,
        audience: impl Into<String>,
        discovery_url: &str,
    ) -> Result<Self, AtriumError> {
        let issuer = issuer.into();
        let audience = audience.into();
        if issuer.trim().is_empty() || audience.trim().is_empty() {
            return Err(AtriumError::BadRequest(
                "OIDC issuer and audience are required".into(),
            ));
        }
        validate_url(discovery_url)?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(AtriumError::internal)?;
        let d = client
            .get(discovery_url)
            .send()
            .await
            .map_err(provider_err)?
            .error_for_status()
            .map_err(provider_err)?
            .json::<Discovery>()
            .await
            .map_err(provider_err)?;
        if d.issuer != issuer {
            return Err(AtriumError::BadRequest(
                "OIDC discovery issuer does not match configured issuer".into(),
            ));
        }
        validate_url(&d.jwks_uri)?;
        let keys = fetch_keys(&client, &d.jwks_uri).await?;
        Ok(Self {
            client,
            jwks_url: d.jwks_uri,
            issuer,
            audience,
            cache: Arc::new(Mutex::new(KeyCache {
                keys,
                refreshed: Instant::now()
                    .checked_sub(Duration::from_secs(2))
                    .unwrap_or_else(Instant::now),
            })),
            refresh_lock: Arc::new(Mutex::new(())),
        })
    }
    async fn refresh(&self) -> Result<(), AtriumError> {
        let keys = fetch_keys(&self.client, &self.jwks_url).await?;
        {
            let mut cache = self.cache.lock().await;
            cache.keys = keys;
            cache.refreshed = Instant::now();
        }
        Ok(())
    }
}
async fn fetch_keys(
    c: &reqwest::Client,
    url: &str,
) -> Result<HashMap<String, DecodingKey>, AtriumError> {
    let s = c
        .get(url)
        .send()
        .await
        .map_err(provider_err)?
        .error_for_status()
        .map_err(provider_err)?
        .json::<JwkSet>()
        .await
        .map_err(provider_err)?;
    let mut m = HashMap::new();
    for j in s.keys {
        if j.kty == "RSA" {
            if let Ok(k) = DecodingKey::from_rsa_components(&j.n, &j.e) {
                m.insert(j.kid, k);
            }
        }
    }
    if m.is_empty() {
        return Err(AtriumError::ProviderUnavailable(
            "OIDC JWKS has no usable keys".into(),
        ));
    }
    Ok(m)
}
fn provider_err<E: std::fmt::Display>(e: E) -> AtriumError {
    AtriumError::ProviderUnavailable(format!("OIDC provider unavailable: {e}"))
}
fn validate_url(u: &str) -> Result<(), AtriumError> {
    let p =
        reqwest::Url::parse(u).map_err(|_| AtriumError::BadRequest("invalid OIDC URL".into()))?;
    if p.scheme() == "https"
        || p.scheme() == "http"
            && p.host_str()
                .is_some_and(|h| matches!(h, "localhost" | "127.0.0.1" | "::1"))
    {
        Ok(())
    } else {
        Err(AtriumError::BadRequest(
            "OIDC URL must use HTTPS unless loopback".into(),
        ))
    }
}
#[axum::async_trait]
impl IdentityProvider for JwtJwksProvider {
    async fn authenticate(&self, parts: &Parts) -> Result<UserId, AtriumError> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AtriumError::Unauthorized("missing bearer token".into()))?;
        let header =
            decode_header(token).map_err(|_| AtriumError::Unauthorized("invalid JWT".into()))?;
        if header.alg != Algorithm::RS256 {
            return Err(AtriumError::Unauthorized(
                "unsupported JWT algorithm".into(),
            ));
        }
        let kid = header
            .kid
            .ok_or_else(|| AtriumError::Unauthorized("JWT is missing kid".into()))?;
        let mut key = self.cache.lock().await.keys.get(&kid).cloned();
        if key.is_none() {
            let _refresh_guard = self.refresh_lock.lock().await;
            key = self.cache.lock().await.keys.get(&kid).cloned();
            if key.is_none() {
                self.refresh().await?;
                key = self.cache.lock().await.keys.get(&kid).cloned();
            }
        }
        let key = key.ok_or_else(|| AtriumError::Unauthorized("unknown JWT key".into()))?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.validate_nbf = true;
        validation.set_issuer(&[self.issuer.as_str()]);
        validation.set_audience(&[self.audience.as_str()]);
        let claims = decode::<Claims>(token, &key, &validation)
            .map_err(|_| AtriumError::Unauthorized("invalid JWT".into()))?
            .claims;
        if claims.sub.trim().is_empty() {
            return Err(AtriumError::Unauthorized("JWT subject is empty".into()));
        }
        Ok(UserId::new(claims.sub))
    }
}
/// Authenticated caller extracted from request state.
#[derive(Debug, Clone)]
pub struct Caller(pub UserId);
#[axum::async_trait]
impl FromRequestParts<AtriumState> for Caller {
    type Rejection = AtriumError;
    async fn from_request_parts(p: &mut Parts, s: &AtriumState) -> Result<Self, Self::Rejection> {
        s.identity().authenticate(p).await.map(Caller)
    }
}
/// Authentication unit tests.
#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use axum::http::{header::AUTHORIZATION, request::Parts, Request};
    fn p(a: &str) -> Parts {
        Request::builder()
            .uri("/")
            .header(AUTHORIZATION, a)
            .body(())
            .unwrap()
            .into_parts()
            .0
    }
    #[tokio::test]
    async fn dev() {
        assert_eq!(
            DevBearerProvider
                .authenticate(&p("Bearer alice"))
                .await
                .unwrap()
                .as_str(),
            "alice"
        );
    }
    #[tokio::test]
    async fn insecure() {
        assert!(
            JwtJwksProvider::from_config("https://i", "a", "http://example.com")
                .await
                .is_err()
        );
    }
}
