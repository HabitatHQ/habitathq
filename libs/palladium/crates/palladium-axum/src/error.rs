//! HTTP error type for `palladium-axum`.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::json;

/// JSON body returned for all error responses: `{ "error": "…" }`.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ErrorBody {
    /// Human-readable description of the error.
    pub error: String,
}

/// Application-level HTTP error, convertible to an [`axum`] [`Response`].
///
/// All handler errors are mapped through this type before being returned
/// to the client as JSON `{ "error": "…" }`.
#[derive(Debug)]
pub enum AppError {
    /// The requested resource was not found.
    NotFound,
    /// The request body or parameters were invalid.
    BadRequest(String),
    /// An unexpected internal error occurred.
    Internal(Box<dyn std::error::Error + Send + Sync>),
}

impl AppError {
    /// Wraps any `Error` as an internal server error.
    ///
    /// Prefer this over a blanket `From<E>` impl so that `AppError` remains
    /// free to implement `std::error::Error` itself in the future.
    pub fn internal(err: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self::Internal(Box::new(err))
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::NotFound => (StatusCode::NOT_FOUND, "not found".to_owned()),
            Self::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            Self::Internal(err) => {
                tracing::error!(%err, "internal server error");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal server error".to_owned())
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    use super::AppError;

    #[test]
    fn not_found_maps_to_404() {
        let resp = AppError::NotFound.into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn bad_request_maps_to_400() {
        let resp = AppError::BadRequest("oops".into()).into_response();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn internal_maps_to_500() {
        let err = std::io::Error::other("boom");
        let resp = AppError::internal(err).into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
