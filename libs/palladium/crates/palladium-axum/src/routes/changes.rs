//! Versioned change history handlers.
use crate::{auth::AuthScope, error::AppError, state::AppState};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use palladium_core::{AppendCursor, Change, ChangeStore, MAX_PAGE_SIZE};
use serde::Deserialize;

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub(super) struct ListQuery {
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[utoipa::path(post, path="/v1/changes", tag="changes", request_body=Change, responses((status=201, description="accepted")))]
pub(super) async fn post_changes<S>(
    State(state): State<AppState<S>>,
    AuthScope(scope): AuthScope,
    Json(change): Json<Change>,
) -> Result<impl IntoResponse, AppError>
where
    S: ChangeStore + Send + Sync,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    let outcome = state
        .store
        .insert(&scope, &change)
        .await
        .map_err(AppError::internal)?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({"version":1,"outcome":format!("{outcome:?}")})),
    ))
}

#[utoipa::path(get, path="/v1/changes", tag="changes", params(ListQuery), responses((status=200, description="page")))]
pub(super) async fn get_changes<S>(
    State(state): State<AppState<S>>,
    AuthScope(scope): AuthScope,
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
    let page = state
        .store
        .page(
            &scope,
            after.as_ref(),
            params.limit.unwrap_or(MAX_PAGE_SIZE),
        )
        .await
        .map_err(AppError::internal)?;
    Ok(Json(page))
}
