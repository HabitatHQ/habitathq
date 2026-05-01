# Bug: "Unsupported bind() argument type: object"

**Status:** Fixed
**File:** `app/workers/database.worker.ts`
**Symptom:** Home page (and any page using `db.selectObject`, `db.selectObjects`, or `db.selectValue` with bound parameters) crashes with:

```
Unsupported bind() argument type: object
```

## Root cause

The `B()` bind helper wraps values as `{ bind: [...] }`:

```ts
const B = (values: any[]): any => ({ bind: values })
```

This format is correct for `db.exec()` because sqlite-wasm's internal `parseExecArgs` treats the second argument as an options bag and extracts the `.bind` property:

```ts
// db.exec sees 2 args → out.opt = args[1] → opt.bind = [...]
db.exec('INSERT INTO users VALUES (?,?)', B(['id', 'name']))
//                                        ↑ { bind: ['id', 'name'] }
//                                          parseExecArgs extracts .bind → ['id', 'name'] ✓
```

However, `db.selectObject()`, `db.selectObjects()`, and `db.selectValue()` pass the bind argument **directly** to `stmt.bind()`:

```ts
// selectObject → __selectFirstRow → stmt.bind(bind)
db.selectObject('SELECT * FROM users WHERE id = ?', B(['id']))
//                                                  ↑ { bind: ['id'] }
//                                                    stmt.bind({ bind: ['id'] }) ✗
```

`stmt.bind()` sees a non-array object and enters the **named-parameter** code path. It iterates over the object's keys, finds `"bind"`, and tries to bind the value — which is an array (`typeof 'object'`). Since arrays are not a supported bind type, it throws.

### sqlite-wasm internals (v3.51.2-build6, `dist/index.mjs`)

```
stmt.bind(arg)
  ├─ arg is Array     → bind positionally (line 7671)  ✓
  ├─ arg is null      → bind null (line 7670)           ✓
  ├─ arg is object    → bind by name (line 7676)        ← our path
  │   └─ Object.keys(arg).forEach(k =>
  │        bindOne(this, k, affirmSupportedBindType(arg[k]), arg[k]))
  │        ↑ arg["bind"] is an Array
  │          typeof Array === 'object'
  │          → "Unsupported bind() argument type: object"  ✗
  └─ otherwise        → bind single value at index 1
```

### Why only select methods are affected

| Method | How bind reaches `stmt.bind()` | `B()` works? |
|--------|-------------------------------|:---:|
| `db.exec(sql, opts)` | `parseExecArgs` extracts `opts.bind` → raw array | Yes |
| `db.selectObject(sql, bind)` | Passed directly to `stmt.bind(bind)` | **No** |
| `db.selectObjects(sql, bind)` | Wrapped into `db.exec({sql, bind, ...})` → `opt.bind` is `{bind:[...]}` not `[...]` | **No** |
| `db.selectValue(sql, bind)` | Passed directly to `stmt.bind(bind)` | **No** |

## Fix

Monkey-patch the three select methods to unwrap `{ bind: [...] }` into a raw array before forwarding to the original implementation:

```ts
for (const m of ['selectObject', 'selectObjects', 'selectValue'] as const) {
  const orig = (db as any)[m].bind(db)
  ;(db as any)[m] = (sql: string, b?: any, ...rest: any[]) =>
    orig(sql, b && typeof b === 'object' && !Array.isArray(b) ? b.bind : b, ...rest)
}
```

This is placed immediately after the `B()` definition in `database.worker.ts`. Zero changes to any call site.

## Affected queries (before fix)

Every `db.selectObject`, `db.selectObjects`, or `db.selectValue` call that used `B()` was broken. This includes:

- `GET_DASHBOARD_SUMMARY` — `selectValue` for spent/income totals and per-envelope spending
- `GET_TRANSACTIONS` — `selectObjects` with LIMIT/OFFSET
- `GET_TRANSACTION` — `selectObject` by id
- `GET_ENVELOPES_WITH_SPENDING` — `selectValue` + `selectObject`
- `GET_ENVELOPE_WITH_SPENDING` — `selectValue` + `selectObject`
- All entity lookups after CREATE/UPDATE (return the row via `selectObject`)
- `GET_CHORES_WITH_STATUS` — `selectObject` for completion join
- `GET_MERCHANT_MAPPING` — `selectObject` by merchant
- `GET_RECURRING_PATTERNS` — `selectObjects` with status filter
- `GET_MONTHLY_TOTALS` — `selectObjects` with month count
- `GET_RECEIPT_IMAGE` — `selectObject` by transaction_id

`db.exec()` calls (INSERT, UPDATE, DELETE) were **not** affected.
