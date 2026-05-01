# Hearth — Personal & Family Expense Tracker
## Product Design Document

---

## 1. Overview

**Hearth** is a self-hostable, multi-user expense tracker for individuals, couples, families, and shared households. It combines envelope-based budgeting, Splitwise-style IOU splitting, full income tracking, and cash flow forecasting in a clean, minimal interface across web, mobile, and CLI.

### Core Objectives
- Track all spending and income with full history
- Enforce envelope budgets at both individual and household level
- Support multi-user households with privacy controls and children's features
- Operate fully offline; sync when connected
- Remain 100% self-hostable with no mandatory cloud dependency

---

## 2. Users & Access Model

### User Types

| Role | Description |
|---|---|
| **Owner** | Primary account holder; full admin access |
| **Partner** | Adult co-user; full access to shared data, private transactions hidden by default |
| **Family Member** | Adult sub-account; role-based access configurable by Owner |
| **Child** | Restricted sub-account; sees own summary only; controlled by parent |

### Authentication
- Email + password (bcrypt/argon2)
- Social login: Google, Apple
- 2FA enforced (TOTP via authenticator app)
- Session timeout on inactivity (configurable; default 30 min mobile, 2h web)
- Passkey support planned for v2

### Privacy Controls
- Transactions can be marked **private** — visible only to the creating user
- Children's accounts: read-only dashboard showing only their own spending
- Parents see all child transactions; children never see parent transactions
- Owner can configure per-role data visibility

---

## 3. Supported Platforms

| Platform | Implementation |
|---|---|
| **Web** | Nuxt 3 (Vue 3) SPA/SSR |
| **Mobile (iOS + Android)** | Capacitor wrapping the Nuxt web app |
| **CLI** | Standalone Rust binary; command mode + interactive TUI |
| **PWA** | Service worker for offline; installable from browser |

---

## 4. Data Model

### Accounts
Each user can have multiple accounts:
- Checking / Savings (bank)
- Credit Card
- Cash (physical wallet)

Transfers between accounts are tracked as type `transfer` and excluded from budget calculations.

### Transactions
Fields per transaction:
- `id`, `date`, `amount`, `currency`
- `account_id`, `user_id`
- `type`: expense | income | transfer
- `category_id` (hierarchical)
- `tags[]` (free-form)
- `description`, `merchant`
- `is_private` (boolean)
- `is_recurring` (auto-detected or manual)
- `split` (optional, references IOU record)
- `attachments[]` (receipt photos, PDFs)
- `created_at`, `updated_at`

### Categories
- Hierarchical: parent + subcategory (e.g. Food > Groceries)
- Global defaults shared across household
- Per-user overrides allowed
- Auto-categorization: system suggests category from merchant name; user confirms

### Envelopes (Budgets)
- Each envelope maps to one or more categories
- Can be personal or household-wide
- Rollover rules: surplus carries forward; overspending deducted from next period
- Savings goals are implemented as special envelopes with a target balance

---

## 5. Multi-Currency

- All transactions stored with original currency + amount
- Base currency configurable per user/household
- Exchange rates fetched daily (open exchange rates or ECB)
- Reports display in base currency with conversion note
- Historical rates stored for accurate past-period reporting

---

## 6. Envelope Budgeting

- Inspired by YNAB envelope method
- Every dollar of income assigned to an envelope before spending
- Envelope states: funded | overspent | rolled-over
- Two rollover modes (both active):
  - Surplus → added to next month's envelope
  - Deficit → deducted from next month's envelope
- Envelopes exist at two scopes:
  - **Personal** — tracked per individual
  - **Household** — personal envelopes roll up into household totals

---

## 7. Splitwise-Style IOUs

- Any expense can be split between household members (or external people)
- Split methods: equal, custom percentage, custom amount
- Running balance shows who owes whom
- Settle up: record a manual payment to clear IOU balance
- External payees (non-users) supported by name

---

## 8. Recurring Transactions & Subscriptions

- System auto-detects recurring patterns (same merchant, similar amount, regular interval)
- Suggested recurring rules require user confirmation
- Recurring transactions projected into future for bill scheduling and cash flow forecast
- Alerts configurable: in-app, push notification, weekly digest

---

## 9. Income Tracking

- Income sources: salary, freelance, dividends, rental, gifts, other
- Income transactions feed envelope allocation workflow
- Irregular income handled manually; regular salary can be scheduled

---

## 10. Cash Flow Forecasting

- Projects account balance forward using:
  - Scheduled recurring bills
  - Projected income (scheduled paydays)
  - Average variable spending per category
- Visualized as a balance-over-time line chart
- Alerts if projected balance goes negative

---

## 11. Savings Goals & Debt

### Savings Goals
- Implemented as envelope with a target balance and optional target date
- If target date set: required monthly contribution calculated automatically
- Scopes: personal or shared household
- Children can have goals visible to parents

### Debt Payoff
- Track loans and credit card debt with balance, interest rate, minimum payment
- Payoff strategies: avalanche (highest interest first) or snowball (smallest balance first)
- Projected payoff date and total interest shown
- Linked to account balance for automatic tracking

---

## 12. Children's Features

| Feature | Description |
|---|---|
| **Allowance tracking** | Parents record allowance given; kids can log spending against it |
| **Savings goals** | Kids set goals visible to parents; parents can contribute |
| **Spending limits** | Parents set per-category monthly limits for each child |
| **Read-only dashboard** | Child sees: their balance, recent spending, goals — nothing else |

---

## 13. Receipts & Attachments

- Attach photos (JPEG/PNG) or PDFs to any transaction
- OCR extraction: auto-read amount, date, merchant from receipt image (Tesseract or cloud OCR)
- Attachments stored in cloud (S3-compatible object storage when self-hosting)
- Long-term receipt archive with search

---

## 14. Analytics & Reports

### Report Types
- Monthly spending breakdown (pie + bar chart by category)
- Spending trend over time (line chart, month-by-month)
- Per-person breakdown (who spent what in the household)
- Budget vs actual (envelope fill comparison)

### Time Periods
- Weekly, Monthly, Quarterly, Annual/YTD
- Custom date range

### Export Formats
- CSV (all transactions or filtered)
- PDF (formatted report with charts)
- JSON (full data dump via API)

### AI Insights
- On-demand: user queries their data in natural language (e.g. "How much did I spend on dining last quarter vs this quarter?")
- Powered by local LLM or configurable external API key (OpenAI-compatible)

---

## 15. Integrations

| Integration | Purpose |
|---|---|
| **Plaid / TrueLayer** | Auto-import bank + credit card transactions |
| **Google Sheets** | Sync transactions to a Google Sheet |
| **Google/Apple Calendar** | Show scheduled bills on calendar |
| **Slack / Telegram** | Budget alerts and weekly digest via bot |
| **SMTP** | Email notifications (self-configured) |
| **FCM / APNs** | Mobile push notifications |
| **Web push** | Browser push notifications |
| **Webhooks** | POST events to any URL |

### Bank Sync Strategy
- Auto-import where available (Plaid/TrueLayer)
- CSV import for unsupported banks
- Cash transactions always manual entry
- Duplicate detection on import

---

## 16. REST API

- Full REST API, all features accessible
- JWT bearer token authentication
- OAuth2 scopes for third-party app access
- Versioned: `/api/v1/`
- OpenAPI spec published at `/api/docs`
- Rate limiting per token
- Webhook support: subscribe to transaction, budget, and alert events

---

## 17. CLI Tool

Two modes:

### Command mode (scripting/automation)
```
hearth login
hearth add expense --amount 12.50 --category "Food/Lunch" --account checking
hearth report monthly --year 2026 --format csv
hearth envelope list
hearth export --format json --output backup.json
hearth import --from ynab export.csv
```

### Interactive TUI mode
```
hearth tui
```
Full terminal UI with keyboard navigation: transaction list, envelope dashboard, quick-add form, reports.

---

## 18. Tech Stack

### Backend
- **Language**: Rust
- **Framework**: Axum
- **ORM**: SQLx (async, compile-time checked queries)
- **Task queue**: Tokio background tasks (+ optional Redis for distributed)
- **OCR**: Tesseract via FFI or cloud OCR endpoint
- **Auth**: JWT (access tokens) + refresh tokens stored in DB

### Database
- **Primary**: PostgreSQL — all relational data, transactions, users, envelopes
- **Embedded/offline**: SQLite — mobile offline store (synced to Postgres on reconnect)
- **Migrations**: sqlx-migrate

### Frontend
- **Framework**: Nuxt 3 (Vue 3, TypeScript)
- **State**: Pinia
- **UI library**: Custom component set (clean/minimal aesthetic)
- **Charts**: Chart.js or ECharts
- **Offline**: Service worker + IndexedDB cache

### Mobile
- **Wrapper**: Capacitor (iOS + Android)
- **Offline sync**: Background sync via Capacitor plugin + SQLite local store
- **Widgets**: Native iOS/Android widgets via Capacitor community plugin
- **Voice input**: Web Speech API (browser) + native speech-to-text via Capacitor
- **Push**: FCM (Android) + APNs (iOS) via Capacitor Push Notifications plugin

### CLI
- **Language**: Rust (shared core library with backend)
- **TUI**: `ratatui` crate
- **Config**: `~/.config/hearth/config.toml`

---

## 19. Security

| Control | Implementation |
|---|---|
| **2FA** | TOTP (RFC 6238); enforced on all accounts |
| **Audit log** | Immutable log of all data reads, writes, deletes; queryable by Owner |
| **Session timeout** | Configurable inactivity timeout; default 30 min mobile / 2h web |
| **Data encryption at rest** | Postgres column-level encryption for sensitive fields; filesystem encryption recommended for self-hosters |
| **End-to-end encryption** | Optional E2EE mode: client-side encryption before upload; server stores ciphertext only |
| **HTTPS** | TLS required; HSTS enforced |
| **Password policy** | Min 12 chars; bcrypt/argon2 hashing |

---

## 20. Self-Hosting & Deployment

### Docker Compose (simple)
Single `docker-compose.yml` with:
- `hearth-api` (Rust/Axum)
- `postgres`
- `redis` (optional, for queues/cache)
- `minio` (S3-compatible object storage for receipts)
- `caddy` (reverse proxy + automatic TLS)

### Kubernetes (advanced)
Helm chart provided with:
- Deployment + HPA for API
- StatefulSet for Postgres (or external DB)
- PersistentVolumeClaims for storage
- ConfigMaps + Secrets

### Bare Metal
- Pre-built binaries for Linux (amd64, arm64)
- systemd service file provided
- SQLite mode available (no Postgres needed for single-user)

### Backup & Data Portability
- Automated scheduled Postgres dumps (pg_dump → compressed, configurable S3 upload)
- Full data export: JSON or CSV at any time via UI or API
- Import from: YNAB (v4 + nYNAB), Mint CSV, Firefly III JSON, generic CSV
- E2EE key backup: encrypted key export to user's secure storage

---

## 21. Dashboard Layout

```
┌─────────────────────────────────────────────────────┐
│  Hearth          February 2026        [+ Add]  [👤] │
├─────────────────────────────────────────────────────┤
│  SPENT THIS MONTH          REMAINING BUDGET          │
│  $2,847                    $1,153 of $4,000          │
├──────────────────┬──────────────────────────────────┤
│  ENVELOPES       │  RECENT TRANSACTIONS              │
│  🍔 Food  ████░  │  Whole Foods      -$87   Food     │
│     $340/$500    │  ACME Internet    -$60   Bills    │
│  🚗 Auto  ██░░░  │  Paycheck       +$3,200  Income   │
│     $120/$300    │  Coffee Shop      -$6    Food     │
│  🎯 Vacation ██░ │  Amazon           -$43   Shopping │
│     $200/$500    │                                   │
├──────────────────┴──────────────────────────────────┤
│  SAVINGS GOALS                                       │
│  Vacation Fund   ████████░░  $800 / $1,000           │
│  Emergency Fund  ████░░░░░░  $4,000 / $10,000        │
└─────────────────────────────────────────────────────┘
```

---

## 22. MVP Scope (v1.0)

Phase 1 — **Core + Family**:

- [ ] User auth (email/password, Google, 2FA)
- [ ] Primary + sub-accounts (family members, children)
- [ ] Transaction CRUD (expense, income, transfer)
- [ ] Hierarchical categories + tags
- [ ] Envelope budgeting (personal + household)
- [ ] Rollover logic (surplus + deficit)
- [ ] IOU splitting between household members
- [ ] Monthly/trend reports + budget vs actual
- [ ] CSV import + export
- [ ] Web app (Nuxt 3)
- [ ] Mobile app (Capacitor)
- [ ] Docker Compose self-hosting
- [ ] REST API + OpenAPI spec

Phase 2 — **Integrations & Intelligence**:
- Bank sync (Plaid/TrueLayer)
- Receipt OCR
- Cash flow forecasting
- Recurring auto-detection
- Savings goals + debt payoff
- AI on-demand insights
- CLI TUI
- Google Sheets + Calendar integrations
- Kubernetes Helm chart
- E2EE option

---

## 23. Open Questions

1. Exchange rate source: ECB (free, daily) vs Open Exchange Rates (paid, hourly)?
2. OCR: self-hosted Tesseract vs cloud API (Google Vision / AWS Textract)?
3. LLM for AI insights: local (Ollama) vs user-supplied API key (OpenAI-compatible)?
4. Plaid (US-focused) vs TrueLayer (EU-focused) vs both with geo-detection?
5. Notification email: bundled SMTP config or support for SendGrid/Resend/Postmark?

---

## 24. Frontend Design Decisions (v0.1 — March 2026)

Decisions made during initial frontend build. Update as design evolves.

### Navigation

- **Bottom tabs (4)**: Dashboard · Transactions · Envelopes · Reports
- **Household / IOU**: Sub-page (`/household`) linked from Dashboard widget — no 5th tab
- **Add Transaction**: Dedicated page (`/transactions/add`) launched via FAB on Dashboard + Transactions
- **Settings**: Accessible via avatar menu in top-right header
- **Avatar menu also links to**: `/household`

### Visual Design

- **Color palette**: Amber primary (`#f59e0b`) matching the "Hearth" brand metaphor (fire/warmth)
  - Dark bg: `#0c1219` (warm-shifted slate-950)
  - Light bg: `#fefaf4` (warm off-white)
  - Themes: Hearth (amber) · Forest (teal-green) · Ocean (indigo) — switcher in header
- **Financial numbers**: `font-mono` class for precision, tabular-nums. Large spending amounts use size split: big whole part, smaller decimal.
- **Envelope bars**: Horizontal progress bar, animated fill on mount (CSS `@keyframes bar-fill`). Color: green (< 70% used) → amber (70–100%) → rose (overspent).
- **Transaction rows**: Left 3px accent stripe — green for income, muted border for expense, dashed border for transfer
- **Envelope status badges**: "Over" (rose) and "Almost full" (amber) inline badges

### Target Persona (v0.1)

Full multi-user model from the start with realistic mock seed data (2 household members: Alex + Sam). All features designed to work for solo, couple, and family users.

### Data Storage

- **SQLite WASM (OPFS)** via dedicated web worker from day one
- Lock key: `hearth-db` (one tab enforced)
- Seed data applied once on first run (`applied_defaults` table)
- Schema v1: users, accounts, categories, transactions, envelopes, envelope_periods, iou_splits, savings_goals

### Add Transaction UX

- Dedicated page + FAB (not modal sheet)
- Custom number pad with backspace and decimal
- Amount display live-updates as user types
- Toggle: expense / income / transfer (changes available fields)
- Split toggle: inline IOU creation with split-amount field

### Dashboard Layout

Based on design.md §21 mockup:
- Period navigator (prev/next month)
- Hero: large spent amount + remaining budget progress bar + income chip
- Household IOU widget (→ `/household`) — only shown when balances exist
- Two-column on desktop: Envelopes list (left) + Recent Transactions grouped by date (right)
- Savings Goals section below

### Testing Strategy

- **Red/green TDD**: Write failing tests first, implement, then verify green
- **Unit**: `tests/unit/` — pure utils (`format.ts`), date helpers
- **Integration**: `tests/integration/` — DB composable with mocked worker
- **E2E**: `tests/e2e/` — navigation flows, dashboard render, add transaction
- **A11y**: `tests/a11y/` — axe-core audit per page, 44px touch target checks, keyboard nav
