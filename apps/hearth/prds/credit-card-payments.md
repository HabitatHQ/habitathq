# Credit Card Bill Payments — Design

## Overview

Add computed account balances and smart credit card payment handling to the transfer flow. Credit card payments are modeled as transfers (checking → credit card) with no new transaction types.

> **Implementation status (2026-10):** Schema v10 computes balances from `opening_balance` and transaction rows; Settings supports reconciliation by adjusting opening balance; same-currency transfers to credit accounts offer a full-balance suggestion. Existing signed transaction amounts are preserved (source impacts use the stored amount; incoming transfers add its absolute value). Reconciliation does not create a separate adjustment transaction. Cross-currency transfers remain outside the suggestion flow.


## 1. Computed Account Balances

### Schema migration (user_version 10)

```sql
ALTER TABLE accounts ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_to ON transactions(transfer_to_account_id);
```

**Backfill:** Set `opening_balance` so that `opening_balance + SUM(transaction impacts) = current stored balance`.

```sql
UPDATE accounts SET opening_balance = balance - (
  COALESCE((
    SELECT SUM(CASE WHEN type = 'transfer' THEN -ABS(amount) ELSE amount END)
    FROM transactions WHERE account_id = accounts.id
  ), 0)
  + COALESCE((
    SELECT SUM(ABS(amount))
    FROM transactions WHERE transfer_to_account_id = accounts.id AND type = 'transfer'
  ), 0)
);
```

The legacy `balance` column is retained for import compatibility; account reads expose the computed balance.

### Balance query

```sql
a.opening_balance
+ COALESCE((
  SELECT SUM(CASE WHEN t.type = 'transfer' THEN -ABS(t.amount) ELSE t.amount END)
  FROM transactions t WHERE t.account_id = a.id
), 0)
+ COALESCE((
  SELECT SUM(ABS(t.amount))
  FROM transactions t WHERE t.transfer_to_account_id = a.id AND t.type = 'transfer'
), 0)
AS balance
```

### Sign convention

| Type     | amount field | Effect on account_id | Effect on transfer_to_account_id |
|----------|-------------|---------------------|----------------------------------|
| expense  | -87.43      | -87.43 (down)       | n/a                              |
| income   | +5200       | +5200 (up)          | n/a                              |
| transfer | +500 (stored by current UI) | -500 (down, regardless of stored sign) | +500 (up) |

Transfer rows retain their original signed amount. Account balance calculation interprets a transfer as an outflow from `account_id` (`-ABS(amount)`) and credits `transfer_to_account_id` by `ABS(amount)`.

## 2. Smart Transfer Defaults for CC Payments

When the user selects a `type: 'credit'` account as the **"To"** in the existing transfer flow:

- Show a suggestion chip with the computed CC balance (displayed as positive, e.g., "$890.00")
- Auto-fill description: "Credit card payment"
- Tapping the chip populates the amount field

No new transaction types, no new pages. It's a normal transfer transaction under the hood.

### Mockup

```
Type: [Expense] [Income] [Transfer←]

From: [Joint Checking ▾]
To:   [Visa Credit ▾]  ← triggers smart defaults

┌──────────────────────────┐
│ Suggested: Full balance  │
│           $890.00  [Use] │
└──────────────────────────┘

Amount: [$890.00]
Desc: "Credit card payment" (auto-filled)
```

## 3. Reconciliation

Account detail/edit page gets a **Reconcile** action:

1. User enters their real bank balance
2. System computes: `adjustment = real_balance - computed_balance`
3. Applies: `UPDATE accounts SET opening_balance = opening_balance + ? WHERE id = ?`

### Mockup

```
Joint Checking
Computed balance: $4,137.50

[Reconcile]
┌────────────────────────────┐
│ Actual balance: [$4,250  ] │
│                            │
│ Difference: +$112.50       │
│ (adjusts opening balance)  │
│                            │
│ [Cancel]    [Reconcile]    │
└────────────────────────────┘
```

## 4. Changes by File

| File | Change |
|------|--------|
| `app/lib/db-schema.ts` | Add schema v10 migration (`opening_balance`, legacy-balance backfill, transfer index) for both SQLite adapters |
| `app/lib/db-shared.ts` | Compute balances, reconcile opening balances, preserve legacy imports, and export computed balances |
| `app/workers/database.worker.ts`, `app/lib/db-native.ts` | Use the shared export path; both database adapters apply the same schema and dispatch |
| `app/types/database.ts` | Add `opening_balance` to `Account`, plus `GET_ACCOUNTS_WITH_BALANCES` / `RECONCILE_ACCOUNT` worker requests |
| `app/composables/useDatabase.ts` | Expose computed account reads and reconciliation |
| `app/pages/transactions/add.vue`, `app/pages/settings.vue` | Show same-currency credit-card payment suggestions and provide account reconciliation |

## 5. Out of Scope (future work)

- Credit limit tracking
- Statement close dates / due dates
- Minimum payment calculation
- Balance snapshot caching (optimize only if profiling shows need)
