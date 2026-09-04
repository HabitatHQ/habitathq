//! HTTP error type for `palladium-axum`.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

/// Structured error response.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ErrorBody {
    /// Stable machine-readable code.
    pub code: String,
    /// Human-readable description.
    pub message: String,
}

/// Application-level HTTP error.
#[derive(Debug)]
pub enum AppError {
    /// The requested resource was not found.
    NotFound,
    /// The caller is not permitted to perform the operation.
    Forbidden(String),
    /// The request body or parameters were invalid.
    BadRequest(String),
    /// An unexpected internal error occurred.
    Internal(Box<dyn std::error::Error + Send + Sync>),
}
impl AppError {
    /// Wrap an error as internal.
    pub fn internal(err: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self::Internal(Box::new(err))
    }
}
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Self::NotFound => (StatusCode::NOT_FOUND, "not_found", "not found".to_owned()),
            Self::Forbidden(message) => (StatusCode::FORBIDDEN, "forbidden", message),
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, "invalid_request", message),
            Self::Internal(err) => {
                tracing::error!(%err, "internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "internal server error".to_owned(),
                )
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
