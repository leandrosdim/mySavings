# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
 |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
| `original_month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
 |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
; immutable |
| `current_month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
 |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
; updated on carryover |
| `due_date` | `DATE` | nullable |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `linked_reserve_id` | `BIGINT` | nullable; composite FK → obligations(owner_id, id), self-ref |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','settled','released','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target (self-ref + settlements).
- `FOREIGN KEY (owner_id, current_month_key) REFERENCES monthly_plans(owner_id, month_key)` — obligation belongs to a valid plan.
- `FOREIGN KEY (owner_id, original_month_key) REFERENCES monthly_plans(owner_id, month_key)` — origin month must be a real plan.
- Partial unique index: `(owner_id, origin_template_id, original_month_key) WHERE origin_template_id IS NOT NULL` — one generation per template per month.
- `linked_reserve_id` must reference an obligation with `kind = 'reserved'` (enforced via CHECK + application logic; a trigger is deferred to Step10 to avoid procedural complexity in the schema migration).
- Indexes: `(owner_id, current_month_key)`, `(owner_id, status)`, `(owner_id, kind)`, `(owner_id, due_date)`.

### income_expectations

Expected income per month, **separate from obligations**. Has its own receipt
history (`income_receipts`). Receipts mirror settlements but add to the account
balance instead of subtracting.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$` |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
| `original_month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
 |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
| `original_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; immutable |
| `current_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; updated on carryover |
| `due_date` | `DATE` | nullable |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `linked_reserve_id` | `BIGINT` | nullable; composite FK → obligations(owner_id, id), self-ref |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','settled','released','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target (self-ref + settlements).
- `FOREIGN KEY (owner_id, current_month_key) REFERENCES monthly_plans(owner_id, month_key)` — obligation belongs to a valid plan.
- `FOREIGN KEY (owner_id, original_month_key) REFERENCES monthly_plans(owner_id, month_key)` — origin month must be a real plan.
- Partial unique index: `(owner_id, origin_template_id, original_month_key) WHERE origin_template_id IS NOT NULL` — one generation per template per month.
- `linked_reserve_id` must reference an obligation with `kind = 'reserved'` (enforced via CHECK + application logic; a trigger is deferred to Step10 to avoid procedural complexity in the schema migration).
- Indexes: `(owner_id, current_month_key)`, `(owner_id, status)`, `(owner_id, kind)`, `(owner_id, due_date)`.

### income_expectations

Expected income per month, **separate from obligations**. Has its own receipt
history (`income_receipts`). Receipts mirror settlements but add to the account
balance instead of subtracting.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$` |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
; immutable |
| `current_month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
 |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
| `original_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; immutable |
| `current_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; updated on carryover |
| `due_date` | `DATE` | nullable |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `linked_reserve_id` | `BIGINT` | nullable; composite FK → obligations(owner_id, id), self-ref |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','settled','released','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target (self-ref + settlements).
- `FOREIGN KEY (owner_id, current_month_key) REFERENCES monthly_plans(owner_id, month_key)` — obligation belongs to a valid plan.
- `FOREIGN KEY (owner_id, original_month_key) REFERENCES monthly_plans(owner_id, month_key)` — origin month must be a real plan.
- Partial unique index: `(owner_id, origin_template_id, original_month_key) WHERE origin_template_id IS NOT NULL` — one generation per template per month.
- `linked_reserve_id` must reference an obligation with `kind = 'reserved'` (enforced via CHECK + application logic; a trigger is deferred to Step10 to avoid procedural complexity in the schema migration).
- Indexes: `(owner_id, current_month_key)`, `(owner_id, status)`, `(owner_id, kind)`, `(owner_id, due_date)`.

### income_expectations

Expected income per month, **separate from obligations**. Has its own receipt
history (`income_receipts`). Receipts mirror settlements but add to the account
balance instead of subtracting.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$` |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
; updated on carryover |
| `due_date` | `DATE` | nullable |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `linked_reserve_id` | `BIGINT` | nullable; composite FK → obligations(owner_id, id), self-ref |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','settled','released','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target (self-ref + settlements).
- `FOREIGN KEY (owner_id, current_month_key) REFERENCES monthly_plans(owner_id, month_key)` — obligation belongs to a valid plan.
- `FOREIGN KEY (owner_id, original_month_key) REFERENCES monthly_plans(owner_id, month_key)` — origin month must be a real plan.
- Partial unique index: `(owner_id, origin_template_id, original_month_key) WHERE origin_template_id IS NOT NULL` — one generation per template per month.
- `linked_reserve_id` must reference an obligation with `kind = 'reserved'` (enforced via CHECK + application logic; a trigger is deferred to Step10 to avoid procedural complexity in the schema migration).
- Indexes: `(owner_id, current_month_key)`, `(owner_id, status)`, `(owner_id, kind)`, `(owner_id, due_date)`.

### income_expectations

Expected income per month, **separate from obligations**. Has its own receipt
history (`income_receipts`). Receipts mirror settlements but add to the account
balance instead of subtracting.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
 |
| `source_name` | `TEXT NOT NULL` | |
| `expected_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','received','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- `FOREIGN KEY (owner_id, month_key) REFERENCES monthly_plans(owner_id, month_key)`.
- Partial unique index: `(owner_id, origin_template_id, month_key) WHERE origin_template_id IS NOT NULL`.
- `UNIQUE (owner_id, month_key, source_name)` — one income source per month.
- Index: `(owner_id, month_key)`, `(owner_id, status)`.

### settlements

Immutable expense payment records against obligations. The `planned_cents` on
the obligation is **never mutated**; only settlements grow. Multiple partial
payments are stored as separate rows. `mode` distinguishes
`UPDATE_ACCOUNT` (create payment + subtract from account atomically) from
`ALREADY_REFLECTED` (bank refresh already includes it; no balance change).

A settlement is never UPDATEd after insert. Reversals are separate immutable
rows in `settlement_reversals` that mark the original as reversed (excluded
from paid total, matching `lib/finance/settlements.ts` semantics).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `obligation_id` | `BIGINT NOT NULL` | composite FK → obligations(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `mode` | `TEXT NOT NULL` | CHECK IN ('UPDATE_ACCOUNT','ALREADY_REFLECTED') |
| `account_id` | `BIGINT` | nullable; required when mode = UPDATE_ACCOUNT; composite FK → accounts(owner_id, id) |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | per-operation dedup |

- `UNIQUE (owner_id, idempotency_key)` — deduplicate retries per owner.
- CHECK: when `mode = 'UPDATE_ACCOUNT'` then `account_id IS NOT NULL`.
- Index: `(owner_id, obligation_id)`, `(owner_id, business_date)`.

### settlement_reversals

Immutable reversal records. Each points at the original settlement it reverses.
The original settlement is never UPDATEd; the reversal row is the authoritative
"this settlement is excluded" marker. Overpayment prevention across multiple
settlements is enforced transactionally in Step10, not by a static CHECK.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `original_settlement_id` | `BIGINT NOT NULL` | composite FK → settlements(owner_id, id) |
| `reason` | `TEXT` | nullable |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- `UNIQUE (owner_id, original_settlement_id)` — a settlement can be reversed at most once.
- Index: `(owner_id, original_settlement_id)`.

### income_receipts

Immutable income receipt records, mirroring settlements but for income. Receipts
add to the account balance (UPDATE_ACCOUNT) or are already reflected.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `income_expectation_id` | `BIGINT NOT NULL` | composite FK → income_expectations(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `mode` | `TEXT NOT NULL` | CHECK IN ('UPDATE_ACCOUNT','ALREADY_REFLECTED') |
| `account_id` | `BIGINT` | nullable; required when mode = UPDATE_ACCOUNT; composite FK → accounts(owner_id, id) |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- CHECK: when `mode = 'UPDATE_ACCOUNT'` then `account_id IS NOT NULL`.
- Index: `(owner_id, income_expectation_id)`, `(owner_id, business_date)`.

### income_receipt_reversals

Immutable reversal records for income receipts, mirroring
`settlement_reversals`.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `original_receipt_id` | `BIGINT NOT NULL` | composite FK → income_receipts(owner_id, id) |
| `reason` | `TEXT` | nullable |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- `UNIQUE (owner_id, original_receipt_id)`.
- Index: `(owner_id, original_receipt_id)`.

### account_movements

Immutable record of every balance change on an account. Every settlement
(UPDATE_ACCOUNT), receipt (UPDATE_ACCOUNT), adjustment and transfer creates one
or two movement rows. Movements are the authoritative balance-change ledger;
the account's `current_balance_cents` is a derived/cached value that must equal
the sum of movements. `direction` is `debit` (decreases balance) or `credit`
(increases balance). `amount_cents` is always strictly positive.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `direction` | `TEXT NOT NULL` | CHECK IN ('debit','credit') |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `source_type` | `TEXT NOT NULL` | CHECK IN ('settlement','receipt','adjustment','transfer') |
| `source_id` | `BIGINT` | nullable; ID of the originating operation |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- Index: `(owner_id, account_id, recorded_at)`, `(owner_id, business_date)`.
- `source_id` is not a FK (polymorphic reference); owner-scoping is enforced via
  the `account_id` composite FK and the originating operation's own FKs.

### balance_adjustments

Manual balance refresh replaces (not adds) the current balance. Records old
balance, new balance, signed difference and as-of timestamp. Protects against
concurrent payments using the account's `version` column (optimistic
concurrency). A concurrent payment that changed the balance since the form was
loaded causes the version check to fail safely.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `old_balance_cents` | `BIGINT` | nullable (NULL if never entered before); CHECK within safe bounds |
| `new_balance_cents` | `BIGINT NOT NULL` | CHECK within safe bounds |
| `difference_cents` | `BIGINT NOT NULL` | CHECK within safe bounds (signed) |
| `as_of` | `TIMESTAMPTZ NOT NULL` | |
| `reason` | `TEXT` | nullable |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- Index: `(owner_id, account_id, recorded_at)`.

### internal_transfers

Transfers between two accounts of the same owner. Not income or expenses.
Change individual account balances but not the total B / forecast. Create two
`account_movements` rows (debit from, credit to).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `from_account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `to_account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- CHECK: `from_account_id <> to_account_id`.
- Index: `(owner_id, from_account_id)`, `(owner_id, to_account_id)`.

### operation_log

Idempotency key tracking with payload identity. An operation is identified by
`(owner_id, operation_key)`. A retry with the same key and a matching payload
hash is idempotent (returns the prior result). A retry with the same key but a
**changed** payload hash is **rejected** — changed payload reuse is not silent
deduplication.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `operation_key` | `TEXT NOT NULL` | caller-supplied dedup key |
| `payload_hash` | `TEXT NOT NULL` | SHA-256 of the operation payload |
| `operation_type` | `TEXT NOT NULL` | e.g. 'settlement','receipt','adjustment','transfer' |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, operation_key)` — one result per key per owner.
- Index: `(owner_id, operation_type, created_at)`.

### closing_snapshots

Immutable month-end snapshots. Once a month is closed, its snapshot records
balances, forecast inputs/outputs, savings target and settlement totals. Later
months cannot rewrite a closed snapshot. The `status = 'closed'` on
`monthly_plans` and the presence of a snapshot row together mark immutability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$` |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
| `original_month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
 |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
| `original_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; immutable |
| `current_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; updated on carryover |
| `due_date` | `DATE` | nullable |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `linked_reserve_id` | `BIGINT` | nullable; composite FK → obligations(owner_id, id), self-ref |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','settled','released','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target (self-ref + settlements).
- `FOREIGN KEY (owner_id, current_month_key) REFERENCES monthly_plans(owner_id, month_key)` — obligation belongs to a valid plan.
- `FOREIGN KEY (owner_id, original_month_key) REFERENCES monthly_plans(owner_id, month_key)` — origin month must be a real plan.
- Partial unique index: `(owner_id, origin_template_id, original_month_key) WHERE origin_template_id IS NOT NULL` — one generation per template per month.
- `linked_reserve_id` must reference an obligation with `kind = 'reserved'` (enforced via CHECK + application logic; a trigger is deferred to Step10 to avoid procedural complexity in the schema migration).
- Indexes: `(owner_id, current_month_key)`, `(owner_id, status)`, `(owner_id, kind)`, `(owner_id, due_date)`.

### income_expectations

Expected income per month, **separate from obligations**. Has its own receipt
history (`income_receipts`). Receipts mirror settlements but add to the account
balance instead of subtracting.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$` |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
| `original_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; immutable |
| `current_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; updated on carryover |
| `due_date` | `DATE` | nullable |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `linked_reserve_id` | `BIGINT` | nullable; composite FK → obligations(owner_id, id), self-ref |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','settled','released','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target (self-ref + settlements).
- `FOREIGN KEY (owner_id, current_month_key) REFERENCES monthly_plans(owner_id, month_key)` — obligation belongs to a valid plan.
- `FOREIGN KEY (owner_id, original_month_key) REFERENCES monthly_plans(owner_id, month_key)` — origin month must be a real plan.
- Partial unique index: `(owner_id, origin_template_id, original_month_key) WHERE origin_template_id IS NOT NULL` — one generation per template per month.
- `linked_reserve_id` must reference an obligation with `kind = 'reserved'` (enforced via CHECK + application logic; a trigger is deferred to Step10 to avoid procedural complexity in the schema migration).
- Indexes: `(owner_id, current_month_key)`, `(owner_id, status)`, `(owner_id, kind)`, `(owner_id, due_date)`.

### income_expectations

Expected income per month, **separate from obligations**. Has its own receipt
history (`income_receipts`). Receipts mirror settlements but add to the account
balance instead of subtracting.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
 |
| `source_name` | `TEXT NOT NULL` | |
| `expected_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','received','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- `FOREIGN KEY (owner_id, month_key) REFERENCES monthly_plans(owner_id, month_key)`.
- Partial unique index: `(owner_id, origin_template_id, month_key) WHERE origin_template_id IS NOT NULL`.
- `UNIQUE (owner_id, month_key, source_name)` — one income source per month.
- Index: `(owner_id, month_key)`, `(owner_id, status)`.

### settlements

Immutable expense payment records against obligations. The `planned_cents` on
the obligation is **never mutated**; only settlements grow. Multiple partial
payments are stored as separate rows. `mode` distinguishes
`UPDATE_ACCOUNT` (create payment + subtract from account atomically) from
`ALREADY_REFLECTED` (bank refresh already includes it; no balance change).

A settlement is never UPDATEd after insert. Reversals are separate immutable
rows in `settlement_reversals` that mark the original as reversed (excluded
from paid total, matching `lib/finance/settlements.ts` semantics).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `obligation_id` | `BIGINT NOT NULL` | composite FK → obligations(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `mode` | `TEXT NOT NULL` | CHECK IN ('UPDATE_ACCOUNT','ALREADY_REFLECTED') |
| `account_id` | `BIGINT` | nullable; required when mode = UPDATE_ACCOUNT; composite FK → accounts(owner_id, id) |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | per-operation dedup |

- `UNIQUE (owner_id, idempotency_key)` — deduplicate retries per owner.
- CHECK: when `mode = 'UPDATE_ACCOUNT'` then `account_id IS NOT NULL`.
- Index: `(owner_id, obligation_id)`, `(owner_id, business_date)`.

### settlement_reversals

Immutable reversal records. Each points at the original settlement it reverses.
The original settlement is never UPDATEd; the reversal row is the authoritative
"this settlement is excluded" marker. Overpayment prevention across multiple
settlements is enforced transactionally in Step10, not by a static CHECK.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `original_settlement_id` | `BIGINT NOT NULL` | composite FK → settlements(owner_id, id) |
| `reason` | `TEXT` | nullable |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- `UNIQUE (owner_id, original_settlement_id)` — a settlement can be reversed at most once.
- Index: `(owner_id, original_settlement_id)`.

### income_receipts

Immutable income receipt records, mirroring settlements but for income. Receipts
add to the account balance (UPDATE_ACCOUNT) or are already reflected.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `income_expectation_id` | `BIGINT NOT NULL` | composite FK → income_expectations(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `mode` | `TEXT NOT NULL` | CHECK IN ('UPDATE_ACCOUNT','ALREADY_REFLECTED') |
| `account_id` | `BIGINT` | nullable; required when mode = UPDATE_ACCOUNT; composite FK → accounts(owner_id, id) |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- CHECK: when `mode = 'UPDATE_ACCOUNT'` then `account_id IS NOT NULL`.
- Index: `(owner_id, income_expectation_id)`, `(owner_id, business_date)`.

### income_receipt_reversals

Immutable reversal records for income receipts, mirroring
`settlement_reversals`.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `original_receipt_id` | `BIGINT NOT NULL` | composite FK → income_receipts(owner_id, id) |
| `reason` | `TEXT` | nullable |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- `UNIQUE (owner_id, original_receipt_id)`.
- Index: `(owner_id, original_receipt_id)`.

### account_movements

Immutable record of every balance change on an account. Every settlement
(UPDATE_ACCOUNT), receipt (UPDATE_ACCOUNT), adjustment and transfer creates one
or two movement rows. Movements are the authoritative balance-change ledger;
the account's `current_balance_cents` is a derived/cached value that must equal
the sum of movements. `direction` is `debit` (decreases balance) or `credit`
(increases balance). `amount_cents` is always strictly positive.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `direction` | `TEXT NOT NULL` | CHECK IN ('debit','credit') |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `source_type` | `TEXT NOT NULL` | CHECK IN ('settlement','receipt','adjustment','transfer') |
| `source_id` | `BIGINT` | nullable; ID of the originating operation |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- Index: `(owner_id, account_id, recorded_at)`, `(owner_id, business_date)`.
- `source_id` is not a FK (polymorphic reference); owner-scoping is enforced via
  the `account_id` composite FK and the originating operation's own FKs.

### balance_adjustments

Manual balance refresh replaces (not adds) the current balance. Records old
balance, new balance, signed difference and as-of timestamp. Protects against
concurrent payments using the account's `version` column (optimistic
concurrency). A concurrent payment that changed the balance since the form was
loaded causes the version check to fail safely.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `old_balance_cents` | `BIGINT` | nullable (NULL if never entered before); CHECK within safe bounds |
| `new_balance_cents` | `BIGINT NOT NULL` | CHECK within safe bounds |
| `difference_cents` | `BIGINT NOT NULL` | CHECK within safe bounds (signed) |
| `as_of` | `TIMESTAMPTZ NOT NULL` | |
| `reason` | `TEXT` | nullable |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- Index: `(owner_id, account_id, recorded_at)`.

### internal_transfers

Transfers between two accounts of the same owner. Not income or expenses.
Change individual account balances but not the total B / forecast. Create two
`account_movements` rows (debit from, credit to).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `from_account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `to_account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- CHECK: `from_account_id <> to_account_id`.
- Index: `(owner_id, from_account_id)`, `(owner_id, to_account_id)`.

### operation_log

Idempotency key tracking with payload identity. An operation is identified by
`(owner_id, operation_key)`. A retry with the same key and a matching payload
hash is idempotent (returns the prior result). A retry with the same key but a
**changed** payload hash is **rejected** — changed payload reuse is not silent
deduplication.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `operation_key` | `TEXT NOT NULL` | caller-supplied dedup key |
| `payload_hash` | `TEXT NOT NULL` | SHA-256 of the operation payload |
| `operation_type` | `TEXT NOT NULL` | e.g. 'settlement','receipt','adjustment','transfer' |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, operation_key)` — one result per key per owner.
- Index: `(owner_id, operation_type, created_at)`.

### closing_snapshots

Immutable month-end snapshots. Once a month is closed, its snapshot records
balances, forecast inputs/outputs, savings target and settlement totals. Later
months cannot rewrite a closed snapshot. The `status = 'closed'` on
`monthly_plans` and the presence of a snapshot row together mark immutability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$` |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
; immutable |
| `current_month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
 |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
| `original_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; immutable |
| `current_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; updated on carryover |
| `due_date` | `DATE` | nullable |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `linked_reserve_id` | `BIGINT` | nullable; composite FK → obligations(owner_id, id), self-ref |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','settled','released','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target (self-ref + settlements).
- `FOREIGN KEY (owner_id, current_month_key) REFERENCES monthly_plans(owner_id, month_key)` — obligation belongs to a valid plan.
- `FOREIGN KEY (owner_id, original_month_key) REFERENCES monthly_plans(owner_id, month_key)` — origin month must be a real plan.
- Partial unique index: `(owner_id, origin_template_id, original_month_key) WHERE origin_template_id IS NOT NULL` — one generation per template per month.
- `linked_reserve_id` must reference an obligation with `kind = 'reserved'` (enforced via CHECK + application logic; a trigger is deferred to Step10 to avoid procedural complexity in the schema migration).
- Indexes: `(owner_id, current_month_key)`, `(owner_id, status)`, `(owner_id, kind)`, `(owner_id, due_date)`.

### income_expectations

Expected income per month, **separate from obligations**. Has its own receipt
history (`income_receipts`). Receipts mirror settlements but add to the account
balance instead of subtracting.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$` |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
| `original_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; immutable |
| `current_month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$`; updated on carryover |
| `due_date` | `DATE` | nullable |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `linked_reserve_id` | `BIGINT` | nullable; composite FK → obligations(owner_id, id), self-ref |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','settled','released','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target (self-ref + settlements).
- `FOREIGN KEY (owner_id, current_month_key) REFERENCES monthly_plans(owner_id, month_key)` — obligation belongs to a valid plan.
- `FOREIGN KEY (owner_id, original_month_key) REFERENCES monthly_plans(owner_id, month_key)` — origin month must be a real plan.
- Partial unique index: `(owner_id, origin_template_id, original_month_key) WHERE origin_template_id IS NOT NULL` — one generation per template per month.
- `linked_reserve_id` must reference an obligation with `kind = 'reserved'` (enforced via CHECK + application logic; a trigger is deferred to Step10 to avoid procedural complexity in the schema migration).
- Indexes: `(owner_id, current_month_key)`, `(owner_id, status)`, `(owner_id, kind)`, `(owner_id, due_date)`.

### income_expectations

Expected income per month, **separate from obligations**. Has its own receipt
history (`income_receipts`). Receipts mirror settlements but add to the account
balance instead of subtracting.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
 |
| `source_name` | `TEXT NOT NULL` | |
| `expected_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','received','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- `FOREIGN KEY (owner_id, month_key) REFERENCES monthly_plans(owner_id, month_key)`.
- Partial unique index: `(owner_id, origin_template_id, month_key) WHERE origin_template_id IS NOT NULL`.
- `UNIQUE (owner_id, month_key, source_name)` — one income source per month.
- Index: `(owner_id, month_key)`, `(owner_id, status)`.

### settlements

Immutable expense payment records against obligations. The `planned_cents` on
the obligation is **never mutated**; only settlements grow. Multiple partial
payments are stored as separate rows. `mode` distinguishes
`UPDATE_ACCOUNT` (create payment + subtract from account atomically) from
`ALREADY_REFLECTED` (bank refresh already includes it; no balance change).

A settlement is never UPDATEd after insert. Reversals are separate immutable
rows in `settlement_reversals` that mark the original as reversed (excluded
from paid total, matching `lib/finance/settlements.ts` semantics).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `obligation_id` | `BIGINT NOT NULL` | composite FK → obligations(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `mode` | `TEXT NOT NULL` | CHECK IN ('UPDATE_ACCOUNT','ALREADY_REFLECTED') |
| `account_id` | `BIGINT` | nullable; required when mode = UPDATE_ACCOUNT; composite FK → accounts(owner_id, id) |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | per-operation dedup |

- `UNIQUE (owner_id, idempotency_key)` — deduplicate retries per owner.
- CHECK: when `mode = 'UPDATE_ACCOUNT'` then `account_id IS NOT NULL`.
- Index: `(owner_id, obligation_id)`, `(owner_id, business_date)`.

### settlement_reversals

Immutable reversal records. Each points at the original settlement it reverses.
The original settlement is never UPDATEd; the reversal row is the authoritative
"this settlement is excluded" marker. Overpayment prevention across multiple
settlements is enforced transactionally in Step10, not by a static CHECK.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `original_settlement_id` | `BIGINT NOT NULL` | composite FK → settlements(owner_id, id) |
| `reason` | `TEXT` | nullable |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- `UNIQUE (owner_id, original_settlement_id)` — a settlement can be reversed at most once.
- Index: `(owner_id, original_settlement_id)`.

### income_receipts

Immutable income receipt records, mirroring settlements but for income. Receipts
add to the account balance (UPDATE_ACCOUNT) or are already reflected.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `income_expectation_id` | `BIGINT NOT NULL` | composite FK → income_expectations(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `mode` | `TEXT NOT NULL` | CHECK IN ('UPDATE_ACCOUNT','ALREADY_REFLECTED') |
| `account_id` | `BIGINT` | nullable; required when mode = UPDATE_ACCOUNT; composite FK → accounts(owner_id, id) |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- CHECK: when `mode = 'UPDATE_ACCOUNT'` then `account_id IS NOT NULL`.
- Index: `(owner_id, income_expectation_id)`, `(owner_id, business_date)`.

### income_receipt_reversals

Immutable reversal records for income receipts, mirroring
`settlement_reversals`.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `original_receipt_id` | `BIGINT NOT NULL` | composite FK → income_receipts(owner_id, id) |
| `reason` | `TEXT` | nullable |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- `UNIQUE (owner_id, original_receipt_id)`.
- Index: `(owner_id, original_receipt_id)`.

### account_movements

Immutable record of every balance change on an account. Every settlement
(UPDATE_ACCOUNT), receipt (UPDATE_ACCOUNT), adjustment and transfer creates one
or two movement rows. Movements are the authoritative balance-change ledger;
the account's `current_balance_cents` is a derived/cached value that must equal
the sum of movements. `direction` is `debit` (decreases balance) or `credit`
(increases balance). `amount_cents` is always strictly positive.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `direction` | `TEXT NOT NULL` | CHECK IN ('debit','credit') |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `source_type` | `TEXT NOT NULL` | CHECK IN ('settlement','receipt','adjustment','transfer') |
| `source_id` | `BIGINT` | nullable; ID of the originating operation |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- Index: `(owner_id, account_id, recorded_at)`, `(owner_id, business_date)`.
- `source_id` is not a FK (polymorphic reference); owner-scoping is enforced via
  the `account_id` composite FK and the originating operation's own FKs.

### balance_adjustments

Manual balance refresh replaces (not adds) the current balance. Records old
balance, new balance, signed difference and as-of timestamp. Protects against
concurrent payments using the account's `version` column (optimistic
concurrency). A concurrent payment that changed the balance since the form was
loaded causes the version check to fail safely.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `old_balance_cents` | `BIGINT` | nullable (NULL if never entered before); CHECK within safe bounds |
| `new_balance_cents` | `BIGINT NOT NULL` | CHECK within safe bounds |
| `difference_cents` | `BIGINT NOT NULL` | CHECK within safe bounds (signed) |
| `as_of` | `TIMESTAMPTZ NOT NULL` | |
| `reason` | `TEXT` | nullable |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- Index: `(owner_id, account_id, recorded_at)`.

### internal_transfers

Transfers between two accounts of the same owner. Not income or expenses.
Change individual account balances but not the total B / forecast. Create two
`account_movements` rows (debit from, credit to).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `from_account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `to_account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- CHECK: `from_account_id <> to_account_id`.
- Index: `(owner_id, from_account_id)`, `(owner_id, to_account_id)`.

### operation_log

Idempotency key tracking with payload identity. An operation is identified by
`(owner_id, operation_key)`. A retry with the same key and a matching payload
hash is idempotent (returns the prior result). A retry with the same key but a
**changed** payload hash is **rejected** — changed payload reuse is not silent
deduplication.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `operation_key` | `TEXT NOT NULL` | caller-supplied dedup key |
| `payload_hash` | `TEXT NOT NULL` | SHA-256 of the operation payload |
| `operation_type` | `TEXT NOT NULL` | e.g. 'settlement','receipt','adjustment','transfer' |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, operation_key)` — one result per key per owner.
- Index: `(owner_id, operation_type, created_at)`.

### closing_snapshots

Immutable month-end snapshots. Once a month is closed, its snapshot records
balances, forecast inputs/outputs, savings target and settlement totals. Later
months cannot rewrite a closed snapshot. The `status = 'closed'` on
`monthly_plans` and the presence of a snapshot row together mark immutability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^[0-9]{4}-(0[1-9]|1[0-2])# Owner-scoped financial schema (Step05)

Raw parameterized PostgreSQL through `pg`; no ORM/query builder. All money is
EUR integer **cents** stored as `BIGINT` with CHECK constraints bounded to the
JavaScript safe-integer range so values can be converted at the JS boundary
without precision loss. Business dates are `DATE` (calendar, Europe/Athens, no
UTC shift). Audit timestamps are `timestamptz`.

Every cross-entity relation uses **owner-aware composite foreign keys**: the FK
includes `owner_id` on both sides, so owner A can never reference owner B's
account, obligation, template, income, settlement or movement — even with
direct SQL. The referenced table declares `UNIQUE (owner_id, id)` (or the
equivalent natural key) so the composite FK has a valid target.

## Entity overview

```
users (Step04 identity)
 └── accounts                  continuous, owner-scoped
 └── monthly_plans             one per owner + month_key
 └── recurring_templates       recurring definitions (not themselves liabilities)
 └── obligations               ordinary + reserved, durable identity, carryover
 └── income_expectations       expected income per month (separate from obligations)
      ├── settlements               immutable expense payments
      ├── settlement_reversals      immutable reversal records
      ├── income_receipts            immutable income receipts
      ├── income_receipt_reversals   immutable income receipt reversals
      ├── account_movements          immutable record of every balance change
      ├── balance_adjustments        manual balance refresh (audited old→new)
      ├── internal_transfers         between accounts (not income/expense)
      ├── operation_log              idempotency keys (owner+key+payload)
      ├── closing_snapshots          immutable month-end snapshots
      └── audit_log                  general audit trail
```

## Money bounds

All cents columns are `BIGINT` with a CHECK constraint bounding values to the
JavaScript safe-integer range (`Number.MAX_SAFE_INTEGER` = 9 007 199 254 740
991). This guarantees that any value read from the database can be converted to
a JS `number` without precision loss.

- Non-negative amounts (planned, targets, expected): `>= 0` and `<= MAX_SAFE`.
- Strictly positive amounts (payments, receipts, transfers): `> 0` and
  `<= MAX_SAFE`.
- Balances (may be negative / overdraft): `>= -MAX_SAFE` and `<= MAX_SAFE`.
- Adjustment differences: `>= -MAX_SAFE` and `<= MAX_SAFE` (signed).

## Tables

### accounts

Continuous, owner-scoped bank/tracking accounts. Balance is manually refreshed
(replacing, not adding). `current_balance_cents` is `NULL` when the user has
never entered a balance — this is **setup-incomplete**, distinct from an
explicit zero. `version` supports optimistic concurrency on balance refresh: a
stale concurrent form sends the old version and the UPDATE matches zero rows.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `current_balance_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `balance_as_of` | `TIMESTAMPTZ` | nullable |
| `track_balance` | `BOOLEAN NOT NULL DEFAULT true` | false = never-set balance account |
| `archived` | `BOOLEAN NOT NULL DEFAULT false` | |
| `version` | `BIGINT NOT NULL DEFAULT 1` | optimistic concurrency |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- Index: `accounts(owner_id)`, `accounts(owner_id, archived)`.

### monthly_plans

One plan per owner per calendar month. Month key is `YYYY-MM` (Europe/Athens
boundary). The savings target is a **protected month-end total**, not a
contribution. Lifecycle: `open` → `closed` (immutable snapshot on close).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$` |
| `savings_target_cents` | `BIGINT NOT NULL DEFAULT 0` | CHECK `>= 0, <= MAX_SAFE` |
| `status` | `TEXT NOT NULL DEFAULT 'open'` | CHECK IN ('open','closed') |
| `closed_at` | `TIMESTAMPTZ` | nullable; set on close |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, month_key)` — one plan per owner per month.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### recurring_templates

Recurring definitions (fixed/variable expenses, income, reserves). Templates
are **not themselves liabilities**; they generate obligations or income
expectations per month. Uniqueness on generation is enforced on the generated
entity (obligation/income), not on the template.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `name` | `TEXT NOT NULL` | |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved','income') |
| `default_amount_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `due_day_of_month` | `SMALLINT` | nullable; CHECK 1–31 |
| `active` | `BOOLEAN NOT NULL DEFAULT true` | |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, name)` — one template name per owner.
- `UNIQUE (owner_id, id)` — composite FK reference target.

### obligations

Ordinary expenses and reserved commitments with **durable identity**. The
`id` is immutable and persists across months for carryover. Unpaid carryover
updates `current_month_key` on the **same row** — never a duplicate liability.
`original_month_key` is immutable and records the first month the obligation
appeared. `origin_template_id` is set when generated from a recurring template;
the partial unique index `(owner_id, origin_template_id, original_month_key)`
ensures a template generates at most one obligation per month.

A reserve (`kind = 'reserved'`) is a protected outstanding commitment
**additional to savings**. An ordinary expense may carry `linked_reserve_id`
pointing at a reserve obligation; this marks the ordinary entry as a
**presentation** of that reserve (counted once in R, not duplicated in E). A
reserve is never copied into a second expense liability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `kind` | `TEXT NOT NULL` | CHECK IN ('ordinary','reserved') |
| `title` | `TEXT NOT NULL` | |
| `planned_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE`; immutable |
; updated on carryover |
| `due_date` | `DATE` | nullable |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `linked_reserve_id` | `BIGINT` | nullable; composite FK → obligations(owner_id, id), self-ref |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','settled','released','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target (self-ref + settlements).
- `FOREIGN KEY (owner_id, current_month_key) REFERENCES monthly_plans(owner_id, month_key)` — obligation belongs to a valid plan.
- `FOREIGN KEY (owner_id, original_month_key) REFERENCES monthly_plans(owner_id, month_key)` — origin month must be a real plan.
- Partial unique index: `(owner_id, origin_template_id, original_month_key) WHERE origin_template_id IS NOT NULL` — one generation per template per month.
- `linked_reserve_id` must reference an obligation with `kind = 'reserved'` (enforced via CHECK + application logic; a trigger is deferred to Step10 to avoid procedural complexity in the schema migration).
- Indexes: `(owner_id, current_month_key)`, `(owner_id, status)`, `(owner_id, kind)`, `(owner_id, due_date)`.

### income_expectations

Expected income per month, **separate from obligations**. Has its own receipt
history (`income_receipts`). Receipts mirror settlements but add to the account
balance instead of subtracting.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `month_key` | `TEXT NOT NULL` | CHECK `^\d{4}-\d{2}$` |
| `source_name` | `TEXT NOT NULL` | |
| `expected_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `linked_account_id` | `BIGINT` | nullable; composite FK → accounts(owner_id, id) |
| `origin_template_id` | `BIGINT` | nullable; composite FK → recurring_templates(owner_id, id) |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | CHECK IN ('active','received','cancelled') |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, id)` — composite FK reference target.
- `FOREIGN KEY (owner_id, month_key) REFERENCES monthly_plans(owner_id, month_key)`.
- Partial unique index: `(owner_id, origin_template_id, month_key) WHERE origin_template_id IS NOT NULL`.
- `UNIQUE (owner_id, month_key, source_name)` — one income source per month.
- Index: `(owner_id, month_key)`, `(owner_id, status)`.

### settlements

Immutable expense payment records against obligations. The `planned_cents` on
the obligation is **never mutated**; only settlements grow. Multiple partial
payments are stored as separate rows. `mode` distinguishes
`UPDATE_ACCOUNT` (create payment + subtract from account atomically) from
`ALREADY_REFLECTED` (bank refresh already includes it; no balance change).

A settlement is never UPDATEd after insert. Reversals are separate immutable
rows in `settlement_reversals` that mark the original as reversed (excluded
from paid total, matching `lib/finance/settlements.ts` semantics).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `obligation_id` | `BIGINT NOT NULL` | composite FK → obligations(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `mode` | `TEXT NOT NULL` | CHECK IN ('UPDATE_ACCOUNT','ALREADY_REFLECTED') |
| `account_id` | `BIGINT` | nullable; required when mode = UPDATE_ACCOUNT; composite FK → accounts(owner_id, id) |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | per-operation dedup |

- `UNIQUE (owner_id, idempotency_key)` — deduplicate retries per owner.
- CHECK: when `mode = 'UPDATE_ACCOUNT'` then `account_id IS NOT NULL`.
- Index: `(owner_id, obligation_id)`, `(owner_id, business_date)`.

### settlement_reversals

Immutable reversal records. Each points at the original settlement it reverses.
The original settlement is never UPDATEd; the reversal row is the authoritative
"this settlement is excluded" marker. Overpayment prevention across multiple
settlements is enforced transactionally in Step10, not by a static CHECK.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `original_settlement_id` | `BIGINT NOT NULL` | composite FK → settlements(owner_id, id) |
| `reason` | `TEXT` | nullable |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- `UNIQUE (owner_id, original_settlement_id)` — a settlement can be reversed at most once.
- Index: `(owner_id, original_settlement_id)`.

### income_receipts

Immutable income receipt records, mirroring settlements but for income. Receipts
add to the account balance (UPDATE_ACCOUNT) or are already reflected.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `income_expectation_id` | `BIGINT NOT NULL` | composite FK → income_expectations(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `mode` | `TEXT NOT NULL` | CHECK IN ('UPDATE_ACCOUNT','ALREADY_REFLECTED') |
| `account_id` | `BIGINT` | nullable; required when mode = UPDATE_ACCOUNT; composite FK → accounts(owner_id, id) |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- CHECK: when `mode = 'UPDATE_ACCOUNT'` then `account_id IS NOT NULL`.
- Index: `(owner_id, income_expectation_id)`, `(owner_id, business_date)`.

### income_receipt_reversals

Immutable reversal records for income receipts, mirroring
`settlement_reversals`.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `original_receipt_id` | `BIGINT NOT NULL` | composite FK → income_receipts(owner_id, id) |
| `reason` | `TEXT` | nullable |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- `UNIQUE (owner_id, original_receipt_id)`.
- Index: `(owner_id, original_receipt_id)`.

### account_movements

Immutable record of every balance change on an account. Every settlement
(UPDATE_ACCOUNT), receipt (UPDATE_ACCOUNT), adjustment and transfer creates one
or two movement rows. Movements are the authoritative balance-change ledger;
the account's `current_balance_cents` is a derived/cached value that must equal
the sum of movements. `direction` is `debit` (decreases balance) or `credit`
(increases balance). `amount_cents` is always strictly positive.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `direction` | `TEXT NOT NULL` | CHECK IN ('debit','credit') |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `source_type` | `TEXT NOT NULL` | CHECK IN ('settlement','receipt','adjustment','transfer') |
| `source_id` | `BIGINT` | nullable; ID of the originating operation |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- Index: `(owner_id, account_id, recorded_at)`, `(owner_id, business_date)`.
- `source_id` is not a FK (polymorphic reference); owner-scoping is enforced via
  the `account_id` composite FK and the originating operation's own FKs.

### balance_adjustments

Manual balance refresh replaces (not adds) the current balance. Records old
balance, new balance, signed difference and as-of timestamp. Protects against
concurrent payments using the account's `version` column (optimistic
concurrency). A concurrent payment that changed the balance since the form was
loaded causes the version check to fail safely.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `old_balance_cents` | `BIGINT` | nullable (NULL if never entered before); CHECK within safe bounds |
| `new_balance_cents` | `BIGINT NOT NULL` | CHECK within safe bounds |
| `difference_cents` | `BIGINT NOT NULL` | CHECK within safe bounds (signed) |
| `as_of` | `TIMESTAMPTZ NOT NULL` | |
| `reason` | `TEXT` | nullable |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- Index: `(owner_id, account_id, recorded_at)`.

### internal_transfers

Transfers between two accounts of the same owner. Not income or expenses.
Change individual account balances but not the total B / forecast. Create two
`account_movements` rows (debit from, credit to).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `from_account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `to_account_id` | `BIGINT NOT NULL` | composite FK → accounts(owner_id, id) |
| `amount_cents` | `BIGINT NOT NULL` | CHECK `> 0, <= MAX_SAFE` |
| `business_date` | `DATE NOT NULL` | |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `idempotency_key` | `TEXT NOT NULL` | |

- `UNIQUE (owner_id, idempotency_key)`.
- CHECK: `from_account_id <> to_account_id`.
- Index: `(owner_id, from_account_id)`, `(owner_id, to_account_id)`.

### operation_log

Idempotency key tracking with payload identity. An operation is identified by
`(owner_id, operation_key)`. A retry with the same key and a matching payload
hash is idempotent (returns the prior result). A retry with the same key but a
**changed** payload hash is **rejected** — changed payload reuse is not silent
deduplication.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `operation_key` | `TEXT NOT NULL` | caller-supplied dedup key |
| `payload_hash` | `TEXT NOT NULL` | SHA-256 of the operation payload |
| `operation_type` | `TEXT NOT NULL` | e.g. 'settlement','receipt','adjustment','transfer' |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- `UNIQUE (owner_id, operation_key)` — one result per key per owner.
- Index: `(owner_id, operation_type, created_at)`.

### closing_snapshots

Immutable month-end snapshots. Once a month is closed, its snapshot records
balances, forecast inputs/outputs, savings target and settlement totals. Later
months cannot rewrite a closed snapshot. The `status = 'closed'` on
`monthly_plans` and the presence of a snapshot row together mark immutability.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
 |
| `balances_total_cents` | `BIGINT NOT NULL` | CHECK within safe bounds |
| `pending_income_remaining_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `ordinary_unpaid_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `reserved_outstanding_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `savings_target_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `projected_free_to_spend_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `cash_backed_free_to_spend_cents` | `BIGINT` | nullable; CHECK within safe bounds |
| `settlement_total_cents` | `BIGINT NOT NULL` | CHECK `>= 0, <= MAX_SAFE` |
| `closed_at` | `TIMESTAMPTZ NOT NULL` | |

- `UNIQUE (owner_id, month_key)` — one snapshot per owner per month.
- `FOREIGN KEY (owner_id, month_key) REFERENCES monthly_plans(owner_id, month_key)`.

### audit_log

General audit trail for privileged/sensitive operations (provisioning, balance
adjustments, rollover apply, closing, reversals). Records the operation type,
actor (when available), a safe summary and timestamp. Does not store secrets or
raw payloads.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PRIMARY KEY |
| `owner_id` | `BIGINT NOT NULL` | FK → users(id) ON DELETE CASCADE |
| `operation_type` | `TEXT NOT NULL` | |
| `entity_type` | `TEXT` | nullable |
| `entity_id` | `BIGINT` | nullable |
| `summary` | `TEXT NOT NULL` | safe, no secrets |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- Index: `(owner_id, recorded_at)`, `(owner_id, operation_type)`.

## Invariants enforced in SQL

1. **Owner scoping**: every cross-entity FK is a composite `(owner_id, ...)`
   FK. Owner A cannot attach B's account, obligation, template, income,
   settlement, receipt, movement, adjustment or transfer.
2. **Money bounds**: all cents columns are `BIGINT` with CHECK constraints
   bounded to `±Number.MAX_SAFE_INTEGER`. No unbounded BIGINT reaches the JS
   boundary.
3. **Positive payments**: settlement, receipt and transfer amounts are
   strictly positive (`CHECK > 0`).
4. **Non-negative plans/targets**: planned amounts, savings targets, expected
   income and snapshot totals are non-negative.
5. **Mode/account consistency**: when `mode = 'UPDATE_ACCOUNT'`, `account_id`
   is required (CHECK constraint).
6. **Transfer distinctness**: `from_account_id <> to_account_id` on internal
   transfers.
7. **One plan per owner per month**: `UNIQUE (owner_id, month_key)` on
   `monthly_plans`.
8. **One generation per template per month**: partial unique index on
   obligations and income_expectations for `(owner_id, origin_template_id,
   month_key)`.
9. **One reversal per original**: `UNIQUE (owner_id, original_settlement_id)`
   and `UNIQUE (owner_id, original_receipt_id)`.
10. **Idempotency**: `UNIQUE (owner_id, idempotency_key)` on settlements,
    receipts, reversals, adjustments and transfers; `UNIQUE (owner_id,
    operation_key)` on operation_log.
11. **One snapshot per month**: `UNIQUE (owner_id, month_key)` on
    closing_snapshots.
12. **Paid history survives**: cross-entity FKs use `ON DELETE RESTRICT` so
    deleting an account/obligation with settlements/movements fails; paid
    history does not disappear through cascading deletes. User deletion
    cascades through `owner_id` FKs.

## Invariants deferred to Step10 (transaction logic)

- **Overpayment rejection across multiple settlement rows**: the sum of active
  (non-reversed) settlements must not exceed `planned_cents`. This requires
  row-locking and a transactional check, not a static CHECK. The schema
  stores the data; Step10 enforces the rule.
- **Atomic payment/movement/audit**: a single transaction creates the
  settlement, the account movement, updates the account balance and writes the
  audit entry. The schema supports this; Step10 implements it.
- **Balance-effect reconciliation after post-refresh reversal**: a reversal
  after a manual balance refresh must not blindly reverse the old movement. The
  schema records both the reversal and the adjustment; Step10 reconciles.

## Indexes summary

Indexes are chosen for the expected query shapes: owner-scoped reads by month,
status, date and kind. Composite FK reference targets (`UNIQUE (owner_id, id)`)
also serve as indexes.

| Table | Index | Purpose |
|-------|-------|---------|
| accounts | `(owner_id)` | list owner accounts |
| accounts | `(owner_id, archived)` | active accounts |
| monthly_plans | `(owner_id, month_key)` UNIQUE | find plan by month |
| monthly_plans | `(owner_id, status)` | open/closed plans |
| recurring_templates | `(owner_id, name)` UNIQUE | template by name |
| recurring_templates | `(owner_id, active)` | active templates |
| obligations | `(owner_id, current_month_key)` | obligations in a month |
| obligations | `(owner_id, status)` | active/settled |
| obligations | `(owner_id, kind)` | ordinary vs reserved |
| obligations | `(owner_id, due_date)` | upcoming dues |
| obligations | `(owner_id, origin_template_id, original_month_key)` partial | generation dedup |
| income_expectations | `(owner_id, month_key)` | income in a month |
| income_expectations | `(owner_id, status)` | active/received |
| income_expectations | `(owner_id, month_key, source_name)` UNIQUE | source dedup |
| settlements | `(owner_id, obligation_id)` | payment history |
| settlements | `(owner_id, business_date)` | payments by date |
| settlement_reversals | `(owner_id, original_settlement_id)` UNIQUE | reversal lookup |
| income_receipts | `(owner_id, income_expectation_id)` | receipt history |
| income_receipts | `(owner_id, business_date)` | receipts by date |
| income_receipt_reversals | `(owner_id, original_receipt_id)` UNIQUE | reversal lookup |
| account_movements | `(owner_id, account_id, recorded_at)` | movement history |
| account_movements | `(owner_id, business_date)` | movements by date |
| balance_adjustments | `(owner_id, account_id, recorded_at)` | adjustment history |
| internal_transfers | `(owner_id, from_account_id)` | transfers from |
| internal_transfers | `(owner_id, to_account_id)` | transfers to |
| operation_log | `(owner_id, operation_key)` UNIQUE | idempotency lookup |
| operation_log | `(owner_id, operation_type, created_at)` | operation history |
| closing_snapshots | `(owner_id, month_key)` UNIQUE | snapshot by month |
| audit_log | `(owner_id, recorded_at)` | audit timeline |
| audit_log | `(owner_id, operation_type)` | audit by type |