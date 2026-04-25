# Credit Card Bill Payments — Design

## Overview

Add computed account balances and smart credit card payment handling to the transfer flow. Credit card payments are modeled as transfers (checking → credit card) with no new transaction types.

## 1. Computed Account Balances

### Schema migration (user_version 7)

```sql
ALTER TABLE accounts ADD COLUMN opening_balance REAL NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_to ON transactions(transfer_to_account_id);
```

**Backfill:** Set `opening_balance` so that `opening_balance + SUM(transaction impacts) = current stored balance`.

```sql
UPDATE accounts SET opening_balance = balance - (
  COALESCE((SELECT SUM(amount) FROM transactions WHERE account_id = accounts.id), 0)
  + COALESCE((SELECT SUM(ABS(amount)) FROM transactions WHERE transfer_to_account_id = accounts.id AND type = 'transfer'), 0)
);
```

After backfill, the `balance` column becomes unused (kept for rollback safety, can be dropped later).

### Balance query

```sql
a.opening_balance
+ COALESCE((SELECT SUM(amount) FROM transactions WHERE account_id = a.id), 0)
+ COALESCE((SELECT SUM(ABS(amount)) FROM transactions WHERE transfer_to_account_id = a.id AND type = 'transfer'), 0)
AS balance
```

### Sign convention

| Type     | amount field | Effect on account_id | Effect on transfer_to_account_id |
|----------|-------------|---------------------|----------------------------------|
| expense  | -87.43      | -87.43 (down)       | n/a                              |
| income   | +5200       | +5200 (up)          | n/a                              |
| transfer | -500        | -500 (down)         | +500 (up)                        |

Transfers store a **negative amount** on the source account (consistent with expenses = money leaving). The target account is credited with `ABS(amount)`.

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
| `app/workers/database.worker.ts` | Migration v7 (opening_balance + index + backfill), balance subquery in all account reads, `RECONCILE_ACCOUNT` handler |
| `app/lib/db-native.ts` | Mirror migration + balance query + reconcile |
| `app/types/database.ts` | Add `opening_balance` to `Account` interface, add `GET_ACCOUNTS_WITH_BALANCES` / `RECONCILE_ACCOUNT` to `WorkerRequest` union |
| `app/composables/useDatabase.ts` | Expose `getAccountsWithBalances()`, `reconcileAccount()` |
| `app/pages/transactions/add.vue` | Detect credit account as transfer target, show balance suggestion chip, auto-fill description |
| Account settings/edit page | Reconcile button + modal |

## 5. Out of Scope (future work)

- Credit limit tracking
- Statement close dates / due dates
- Minimum payment calculation
- Balance snapshot caching (optimize only if profiling shows need)
