//! The [`AuthSeam`] derives an authenticated, opaque store [`Scope`].

use std::{future::Future, pin::Pin};

use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use palladium_blobs::BlobId;
use palladium_core::Scope;

use crate::{error::ErrorBody, state::AppState};

type AuthnFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Principal, AuthenticationError>> + Send + 'a>>;
type AuthzFuture<'a> = Pin<Box<dyn Future<Output = Result<Grant, AuthorizationError>> + Send + 'a>>;

/// A verified caller identity supplied by an [`Authenticator`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Principal(String);

impl Principal {
    /// Construct a principal from an identity verified by the host.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
    /// Return the host-defined identity key.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// An operation whose access is being decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(missing_docs)]
pub enum Action {
    ReadChanges,
    WriteChanges,
    CreateBlob,
    ReadBlob,
    DeleteBlob,
    PresignBlob,
}

/// The route-level resource being authorized.
#[allow(missing_docs)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resource {
    ChangeStream,
    BlobCollection,
    Blob(BlobId),
}

/// Input to an [`Authorizer`] decision.
#[derive(Debug, Clone, Copy)]
pub struct AuthorizationRequest<'a> {
    /// Authenticated caller.
    pub principal: &'a Principal,
    /// Requested operation.
    pub action: Action,
    /// Resource targeted by the operation.
    pub resource: Resource,
}

/// A successful authorization result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grant {
    scope: Scope,
}

impl Grant {
    /// Build a grant for an opaque store scope.
    #[must_use]
    pub const fn new(scope: Scope) -> Self {
        Self { scope }
    }
    /// Borrow the authorized store scope.
    #[must_use]
    pub const fn scope(&self) -> &Scope {
        &self.scope
    }
}

/// Authentication failure, rendered using the v1 error envelope.
#[derive(Debug)]
#[allow(missing_docs)]
pub enum AuthenticationError {
    Unauthorized(String),
    Unavailable(String),
}

impl AuthenticationError {
    /// Build an unauthorized rejection.
    #[must_use]
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::Unauthorized(message.into())
    }
    /// Build an unavailable-provider rejection.
    #[must_use]
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::Unavailable(message.into())
    }
}

impl IntoResponse for AuthenticationError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Self::Unauthorized(message) => (StatusCode::UNAUTHORIZED, "unauthorized", message),
            Self::Unavailable(message) => {
                (StatusCode::SERVICE_UNAVAILABLE, "auth_unavailable", message)
            }
        };
        (
            status,
            Json(ErrorBody {
                code: code.to_owned(),
                message,
            }),
        )
            .into_response()
    }
}

/// Authorization failure, rendered using the v1 error envelope.
#[allow(missing_docs)]
#[derive(Debug)]
pub enum AuthorizationError {
    Forbidden(String),
    NotFound,
}

impl AuthorizationError {
    /// Build a forbidden rejection.
    #[must_use]
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::Forbidden(message.into())
    }
}

impl IntoResponse for AuthorizationError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Self::Forbidden(message) => (StatusCode::FORBIDDEN, "forbidden", message),
            Self::NotFound => (StatusCode::NOT_FOUND, "not_found", "not found".to_owned()),
        };
        (
            status,
            Json(ErrorBody {
                code: code.to_owned(),
                message,
            }),
        )
            .into_response()
    }
}

/// Verifies request credentials and returns a typed caller identity.
pub trait Authenticator: Send + Sync + 'static {
    /// Authenticate `parts`.
    fn authenticate<'a>(&'a self, parts: &'a Parts) -> AuthnFuture<'a>;
}

/// Authorizes a route operation and derives its opaque store scope.
pub trait Authorizer: Send + Sync + 'static {
    /// Authorize `request`, returning the only scope route handlers may use.
    fn authorize<'a>(&'a self, request: AuthorizationRequest<'a>) -> AuthzFuture<'a>;
}

/// Development authenticator that maps a bearer token to a principal.
#[derive(Debug, Clone, Default)]
pub struct BearerAuthenticator;

impl Authenticator for BearerAuthenticator {
    fn authenticate<'a>(&'a self, parts: &'a Parts) -> AuthnFuture<'a> {
        Box::pin(async move {
            let token = parts
                .headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AuthenticationError::unauthorized("missing or malformed bearer token")
                })?;
            Ok(Principal::new(token))
        })
    }
}

/// Development authorizer that maps a principal directly to one scope.
#[derive(Debug, Clone, Default)]
pub struct BearerScopeAuthorizer;

impl Authorizer for BearerScopeAuthorizer {
    fn authorize<'a>(&'a self, request: AuthorizationRequest<'a>) -> AuthzFuture<'a> {
        let grant = Grant::new(Scope::new(request.principal.as_str()));
        Box::pin(async move { Ok(grant) })
    }
}

/// A test/local authenticator that always returns one fixed principal.
#[derive(Debug, Clone)]
pub struct StaticAuthenticator(Principal);
impl StaticAuthenticator {
    /// Build an authenticator that always yields `principal`.
    #[must_use]
    pub const fn new(principal: Principal) -> Self {
        Self(principal)
    }
}
impl Authenticator for StaticAuthenticator {
    fn authenticate<'a>(&'a self, _parts: &'a Parts) -> AuthnFuture<'a> {
        let principal = self.0.clone();
        Box::pin(async move { Ok(principal) })
    }
}

/// A test/local authorizer that grants every operation in one fixed scope.
#[derive(Debug, Clone)]
pub struct StaticAuthorizer(Scope);
impl StaticAuthorizer {
    /// Build an authorizer that grants `scope`.
    #[must_use]
    pub const fn new(scope: Scope) -> Self {
        Self(scope)
    }
}
impl Authorizer for StaticAuthorizer {
    fn authorize<'a>(&'a self, _request: AuthorizationRequest<'a>) -> AuthzFuture<'a> {
        let grant = Grant::new(self.0.clone());
        Box::pin(async move { Ok(grant) })
    }
}

/// Axum extractor that authenticates the request once.
#[derive(Debug, Clone)]
pub struct AuthPrincipal(pub Principal);

#[axum::async_trait]
impl<S> FromRequestParts<AppState<S>> for AuthPrincipal
where
    S: Send + Sync,
{
    type Rejection = AuthenticationError;
    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState<S>,
    ) -> Result<Self, Self::Rejection> {
        state.authenticator.authenticate(parts).await.map(Self)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::{
        Action, AuthenticationError, Authenticator, AuthorizationRequest, Authorizer,
        BearerAuthenticator, BearerScopeAuthorizer, Principal, Resource,
    };
    use axum::{
        http::{header::AUTHORIZATION, Request, StatusCode},
        response::IntoResponse,
    };
    fn parts_with(auth: Option<&str>) -> axum::http::request::Parts {
        let mut builder = Request::builder().uri("/");
        if let Some(value) = auth {
            builder = builder.header(AUTHORIZATION, value);
        }
        builder.body(()).unwrap().into_parts().0
    }
    #[tokio::test]
    async fn bearer_authenticator_maps_token_to_principal() {
        let principal = BearerAuthenticator
            .authenticate(&parts_with(Some("Bearer alice")))
            .await
            .unwrap();
        assert_eq!(principal.as_str(), "alice");
    }
    #[tokio::test]
    async fn bearer_authenticator_rejects_missing_or_malformed_token() {
        assert!(BearerAuthenticator
            .authenticate(&parts_with(None))
            .await
            .is_err());
        assert!(BearerAuthenticator
            .authenticate(&parts_with(Some("Basic xyz")))
            .await
            .is_err());
        assert!(BearerAuthenticator
            .authenticate(&parts_with(Some("Bearer   ")))
            .await
            .is_err());
    }
    #[tokio::test]
    async fn bearer_scope_authorizer_derives_scope_from_principal() {
        let principal = Principal::new("alice");
        let grant = BearerScopeAuthorizer
            .authorize(AuthorizationRequest {
                principal: &principal,
                action: Action::ReadChanges,
                resource: Resource::ChangeStream,
            })
            .await
            .unwrap();
        assert_eq!(grant.scope().as_str(), "alice");
    }
    #[test]
    fn failures_use_distinct_statuses() {
        assert_eq!(
            AuthenticationError::unauthorized("x")
                .into_response()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            super::AuthorizationError::forbidden("x")
                .into_response()
                .status(),
            StatusCode::FORBIDDEN
        );
    }
}
