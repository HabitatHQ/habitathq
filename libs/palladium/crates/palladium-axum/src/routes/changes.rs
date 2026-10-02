//! Versioned change history handlers.
use crate::{
    auth::{Action, AuthPrincipal, AuthorizationRequest, Resource},
    error::AppError,
    state::AppState,
};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use palladium_core::{
    AppendCursor, Change, ChangeStore, ClockResponse, InsertOutcome, MAX_PAGE_SIZE,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, utoipa::ToSchema)]
struct PostReceipt {
    version: u8,
    outcome: &'static str,
    cursor: String,
}
#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub(super) struct ListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[utoipa::path(get, path="/v1/clock", tag="changes", responses((status=200, body=ClockResponse, description="authoritative server clock")))]
pub(super) async fn get_clock<S>(
    State(state): State<AppState<S>>,
    AuthPrincipal(principal): AuthPrincipal,
) -> Result<Json<ClockResponse>, AppError>
where
    S: ChangeStore + Send + Sync,
{
    state
        .authorizer
        .authorize(AuthorizationRequest {
            principal: &principal,
            action: Action::ReadChanges,
            resource: Resource::ChangeStream,
        })
        .await
        .map_err(|error| match error {
            crate::auth::AuthorizationError::Forbidden(message) => AppError::Forbidden(message),
            crate::auth::AuthorizationError::NotFound => AppError::NotFound,
        })?;
    let now_millis = state.clock.now_millis().map_err(AppError::internal)?;
    Ok(Json(palladium_core::ClockResponse::v1(now_millis)))
}

#[utoipa::path(post, path="/v1/changes", tag="changes", request_body=Change, responses((status=201, body=PostReceipt, description="accepted")))]
pub(super) async fn post_changes<S>(
    State(state): State<AppState<S>>,
    AuthPrincipal(principal): AuthPrincipal,
    Json(change): Json<Change>,
) -> Result<impl IntoResponse, AppError>
where
    S: ChangeStore + Send + Sync,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    let grant = state
        .authorizer
        .authorize(AuthorizationRequest {
            principal: &principal,
            action: Action::WriteChanges,
            resource: Resource::ChangeStream,
        })
        .await
        .map_err(|error| match error {
            crate::auth::AuthorizationError::Forbidden(message) => AppError::Forbidden(message),
            crate::auth::AuthorizationError::NotFound => AppError::NotFound,
        })?;
    palladium_core::validate_structure(&change).map_err(AppError::BadRequest)?;
    let now_millis = state.clock.now_millis().map_err(AppError::internal)?;
    let outcome = state
        .store
        .insert(grant.scope(), &change, now_millis)
        .await
        .map_err(|error| {
            let message = error.to_string();
            if message.contains("change_conflict") {
                AppError::Conflict("change_conflict".to_owned())
            } else if message.contains("clock_skew") {
                AppError::ClockSkew
            } else {
                AppError::internal(error)
            }
        })?;
    let (outcome, cursor) = match outcome {
        InsertOutcome::Inserted(cursor) => ("inserted", cursor),
        InsertOutcome::Duplicate(cursor) => ("duplicate", cursor),
    };
    Ok((
        StatusCode::CREATED,
        Json(PostReceipt {
            version: 1,
            outcome,
            cursor: cursor.as_str().to_owned(),
        }),
    ))
}

#[utoipa::path(get, path="/v1/changes", tag="changes", params(ListQuery), responses((status=200, body=ChangePage, description="page")))]
pub(super) async fn get_changes<S>(
    State(state): State<AppState<S>>,
    AuthPrincipal(principal): AuthPrincipal,
    Query(params): Query<ListQuery>,
) -> Result<impl IntoResponse, AppError>
where
    S: ChangeStore + Send + Sync,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    let after = params
        .cursor
        .as_deref()
        .map(AppendCursor::parse)
        .transpose()
        .map_err(AppError::BadRequest)?;
    let grant = state
        .authorizer
        .authorize(AuthorizationRequest {
            principal: &principal,
            action: Action::ReadChanges,
            resource: Resource::ChangeStream,
        })
        .await
        .map_err(|error| match error {
            crate::auth::AuthorizationError::Forbidden(message) => AppError::Forbidden(message),
            crate::auth::AuthorizationError::NotFound => AppError::NotFound,
        })?;
    let page = state
        .store
        .page(
            grant.scope(),
            after.as_ref(),
            params.limit.unwrap_or(MAX_PAGE_SIZE),
        )
        .await
        .map_err(AppError::internal)?;
    Ok(Json(page))
}
