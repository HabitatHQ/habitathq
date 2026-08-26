//! Atrium's HTTP error type, convertible to an axum [`Response`].
//!
//! Every handler returns `Result<_, AtriumError>`; the variants map to HTTP
//! status codes and a JSON body `{ "error": "…" }`.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Application-level error for Atrium handlers.
#[derive(Debug, thiserror::Error)]
pub enum AtriumError {
    /// The caller could not be authenticated → `401`.
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    /// The caller is authenticated but not permitted → `403`.
    #[error("forbidden: {0}")]
    Forbidden(String),
    /// The request was malformed → `400`.
    #[error("bad request: {0}")]
    BadRequest(String),
    /// The requested resource does not exist → `404`.
    #[error("not found: {0}")]
    NotFound(String),
    /// The request conflicts with immutable server state → `409`.
    #[error("conflict: {0}")]
    Conflict(String),
    /// An unexpected internal error → `500`.
    #[error("internal error")]
    Internal(#[source] Box<dyn std::error::Error + Send + Sync>),
}

impl AtriumError {
    /// Wrap any error as an internal (`500`) error.
    pub fn internal(err: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self::Internal(Box::new(err))
    }
}

impl From<sqlx::Error> for AtriumError {
    fn from(err: sqlx::Error) -> Self {
        Self::Internal(Box::new(err))
    }
}

impl IntoResponse for AtriumError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Self::Unauthorized(message) => (StatusCode::UNAUTHORIZED, "unauthorized", message),
            Self::Forbidden(message) => (StatusCode::FORBIDDEN, "forbidden", message),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, "not_found", message),
            Self::BadRequest(message) => {
                let code = match message.as_str() {
                    "invalid_cursor" => "invalid_cursor",
                    "invalid_hlc" => "invalid_hlc",
                    "unsupported_version" => "unsupported_version",
                    _ => "invalid_request",
                };
                (StatusCode::BAD_REQUEST, code, message)
            }
            Self::Conflict(message) => {
                let code = match message.as_str() {
                    "change_conflict" => "idempotency_conflict",
                    "clock_skew" => "clock_skew",
                    "expired_checkpoint" => "expired_checkpoint",
                    _ => "conflict",
                };
                (StatusCode::CONFLICT, code, message)
            }
            Self::Internal(err) => {
                tracing::error!(%err, "internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "internal server error".to_owned(),
                )
            }
        };
        (status, Json(json!({ "code": code, "message": message }))).into_response()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::AtriumError;
    use axum::{http::StatusCode, response::IntoResponse};

    #[test]
    fn variants_map_to_expected_status() {
        assert_eq!(
            AtriumError::Unauthorized("x".into())
                .into_response()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            AtriumError::Forbidden("x".into()).into_response().status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            AtriumError::NotFound("x".into()).into_response().status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            AtriumError::BadRequest("x".into()).into_response().status(),
            StatusCode::BAD_REQUEST
        );
        let internal = AtriumError::internal(std::io::Error::other("boom"));
        assert_eq!(
            internal.into_response().status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
