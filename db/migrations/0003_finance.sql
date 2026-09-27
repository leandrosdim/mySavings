-- Step05 owner-scoped financial schema.
-- Raw parameterized SQL; no ORM/query builder. All money is EUR integer cents
-- stored as BIGINT bounded to the JavaScript safe-integer range so any value
-- can be converted at the JS boundary without precision loss. Business dates
-- are DATE (calendar, Europe/Athens, no UTC shift). Audit timestamps are
-- timestamptz.
--
-- Every cross-entity relation uses owner-aware composite foreign keys: the FK
-- includes owner_id on both sides, so owner A can never reference owner B's
-- account, obligation, template, income, settlement or movement even with
-- direct SQL. Referenced tables declare UNIQUE (owner_id, id) (or the
-- equivalent natural key) so the composite FK has a valid target.
--
-- Paid history survives: cross-entity FKs to accounts/obligations use
-- ON DELETE RESTRICT so deleting an entity with settlements/movements fails.
-- User deletion cascades through owner_id FKs.

-- Safe-integer bounds for BIGINT cents. Number.MAX_SAFE_INTEGER =
-- 9007199254740991. Any value within these bounds can be converted to a JS
-- number without precision loss. Used in CHECK constraints on every cents
-- column.

-- accounts: continuous, owner-scoped bank/tracking accounts.
-- current_balance_cents is NULL when never entered (setup-incomplete, distinct
-- from explicit zero). version supports optimistic concurrency on balance
-- refresh: a stale concurrent form sends the old version and the UPDATE
-- matches zero rows.
CREATE TABLE accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  current_balance_cents BIGINT
    CHECK (current_balance_cents IS NULL
      OR (current_balance_cents >= -9007199254740991
        AND current_balance_cents <= 9007199254740991)),
  balance_as_of TIMESTAMPTZ,
  track_balance BOOLEAN NOT NULL DEFAULT true,
  archived BOOLEAN NOT NULL DEFAULT false,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id)
);

CREATE INDEX accounts_owner_idx ON accounts (owner_id);
CREATE INDEX accounts_owner_archived_idx ON accounts (owner_id, archived);

-- monthly_plans: one plan per owner per calendar month (YYYY-MM, Europe/Athens
-- boundary). savings_target_cents is a protected month-end total, not a
-- contribution. status: open -> closed (immutable snapshot on close).
CREATE TABLE monthly_plans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  month_key TEXT NOT NULL
    CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  savings_target_cents BIGINT NOT NULL DEFAULT 0
    CHECK (savings_target_cents >= 0
      AND savings_target_cents <= 9007199254740991),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, month_key)
);

CREATE INDEX monthly_plans_owner_status_idx ON monthly_plans (owner_id, status);

-- recurring_templates: recurring definitions (fixed/variable expenses, income,
-- reserves). Templates are NOT themselves liabilities; they generate
-- obligations or income expectations per month. Uniqueness on generation is
-- enforced on the generated entity (obligation/income), not on the template.
CREATE TABLE recurring_templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('ordinary', 'reserved', 'income')),
  default_amount_cents BIGINT NOT NULL
    CHECK (default_amount_cents >= 0
      AND default_amount_cents <= 9007199254740991),
  due_day_of_month SMALLINT
    CHECK (due_day_of_month IS NULL
      OR (due_day_of_month >= 1 AND due_day_of_month <= 31)),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, name)
);

CREATE INDEX recurring_templates_owner_active_idx
  ON recurring_templates (owner_id, active);

-- obligations: ordinary expenses and reserved commitments with durable
-- identity. The id is immutable and persists across months for carryover.
-- Unpaid carryover updates current_month_key on the SAME row, never a
-- duplicate liability. original_month_key is immutable. origin_template_id is
-- set when generated from a recurring template. linked_reserve_id marks an
-- ordinary expense as a presentation of a reserve (counted once in R, not
-- duplicated in E). A reserve is never copied into a second expense liability.
CREATE TABLE obligations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('ordinary', 'reserved')),
  title TEXT NOT NULL,
  planned_cents BIGINT NOT NULL
    CHECK (planned_cents >= 0 AND planned_cents <= 9007199254740991),
  original_month_key TEXT NOT NULL
    CHECK (original_month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  current_month_key TEXT NOT NULL
    CHECK (current_month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  due_date DATE,
  linked_account_id BIGINT,
  origin_template_id BIGINT,
  linked_reserve_id BIGINT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'settled', 'released', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, linked_account_id)
    REFERENCES accounts (owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, origin_template_id)
    REFERENCES recurring_templates (owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, linked_reserve_id)
    REFERENCES obligations (owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, current_month_key)
    REFERENCES monthly_plans (owner_id, month_key) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, original_month_key)
    REFERENCES monthly_plans (owner_id, month_key) ON DELETE RESTRICT
);

CREATE INDEX obligations_owner_month_idx
  ON obligations (owner_id, current_month_key);
CREATE INDEX obligations_owner_status_idx
  ON obligations (owner_id, status);
CREATE INDEX obligations_owner_kind_idx
  ON obligations (owner_id, kind);
CREATE INDEX obligations_owner_due_date_idx
  ON obligations (owner_id, due_date);
CREATE UNIQUE INDEX obligations_owner_template_month_idx
  ON obligations (owner_id, origin_template_id, original_month_key)
  WHERE origin_template_id IS NOT NULL;

-- income_expectations: expected income per month, separate from obligations.
-- Has its own receipt history (income_receipts). Receipts mirror settlements
-- but add to the account balance instead of subtracting.
CREATE TABLE income_expectations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  month_key TEXT NOT NULL
    CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  source_name TEXT NOT NULL,
  expected_cents BIGINT NOT NULL
    CHECK (expected_cents >= 0 AND expected_cents <= 9007199254740991),
  linked_account_id BIGINT,
  origin_template_id BIGINT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'received', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, month_key, source_name),
  FOREIGN KEY (owner_id, linked_account_id)
    REFERENCES accounts (owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, origin_template_id)
    REFERENCES recurring_templates (owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, month_key)
    REFERENCES monthly_plans (owner_id, month_key) ON DELETE RESTRICT
);

CREATE INDEX income_expectations_owner_month_idx
  ON income_expectations (owner_id, month_key);
CREATE INDEX income_expectations_owner_status_idx
  ON income_expectations (owner_id, status);
CREATE UNIQUE INDEX income_expectations_owner_template_month_idx
  ON income_expectations (owner_id, origin_template_id, month_key)
  WHERE origin_template_id IS NOT NULL;

-- settlements: immutable expense payment records against obligations. The
-- planned_cents on the obligation is never mutated; only settlements grow.
-- Multiple partial payments are stored as separate rows. mode distinguishes
-- UPDATE_ACCOUNT (create payment + subtract from account atomically) from
-- ALREADY_REFLECTED (bank refresh already includes it; no balance change).
-- A settlement is never UPDATEd after insert. Reversals are separate immutable
-- rows in settlement_reversals.
CREATE TABLE settlements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  obligation_id BIGINT NOT NULL,
  amount_cents BIGINT NOT NULL
    CHECK (amount_cents > 0 AND amount_cents <= 9007199254740991),
  mode TEXT NOT NULL
    CHECK (mode IN ('UPDATE_ACCOUNT', 'ALREADY_REFLECTED')),
  account_id BIGINT,
  business_date DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  FOREIGN KEY (owner_id, obligation_id)
    REFERENCES obligations (owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, account_id)
    REFERENCES accounts (owner_id, id) ON DELETE RESTRICT,
  CHECK (mode <> 'UPDATE_ACCOUNT' OR account_id IS NOT NULL)
);

CREATE INDEX settlements_owner_obligation_idx
  ON settlements (owner_id, obligation_id);
CREATE INDEX settlements_owner_date_idx
  ON settlements (owner_id, business_date);

-- settlement_reversals: immutable reversal records. Each points at the
-- original settlement it reverses. The original settlement is never UPDATEd;
-- the reversal row is the authoritative "this settlement is excluded" marker.
CREATE TABLE settlement_reversals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  original_settlement_id BIGINT NOT NULL,
  reason TEXT,
  business_date DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  UNIQUE (owner_id, original_settlement_id),
  FOREIGN KEY (owner_id, original_settlement_id)
    REFERENCES settlements (owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX settlement_reversals_owner_original_idx
  ON settlement_reversals (owner_id, original_settlement_id);

-- income_receipts: immutable income receipt records, mirroring settlements but
-- for income. Receipts add to the account balance (UPDATE_ACCOUNT) or are
-- already reflected.
CREATE TABLE income_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  income_expectation_id BIGINT NOT NULL,
  amount_cents BIGINT NOT NULL
    CHECK (amount_cents > 0 AND amount_cents <= 9007199254740991),
  mode TEXT NOT NULL
    CHECK (mode IN ('UPDATE_ACCOUNT', 'ALREADY_REFLECTED')),
  account_id BIGINT,
  business_date DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  FOREIGN KEY (owner_id, income_expectation_id)
    REFERENCES income_expectations (owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, account_id)
    REFERENCES accounts (owner_id, id) ON DELETE RESTRICT,
  CHECK (mode <> 'UPDATE_ACCOUNT' OR account_id IS NOT NULL)
);

CREATE INDEX income_receipts_owner_income_idx
  ON income_receipts (owner_id, income_expectation_id);
CREATE INDEX income_receipts_owner_date_idx
  ON income_receipts (owner_id, business_date);

-- income_receipt_reversals: immutable reversal records for income receipts.
CREATE TABLE income_receipt_reversals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  original_receipt_id BIGINT NOT NULL,
  reason TEXT,
  business_date DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  UNIQUE (owner_id, original_receipt_id),
  FOREIGN KEY (owner_id, original_receipt_id)
    REFERENCES income_receipts (owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX income_receipt_reversals_owner_original_idx
  ON income_receipt_reversals (owner_id, original_receipt_id);

-- account_movements: immutable record of every balance change on an account.
-- Every settlement (UPDATE_ACCOUNT), receipt (UPDATE_ACCOUNT), adjustment and
-- transfer creates one or two movement rows. direction: debit (decreases) or
-- credit (increases). amount_cents is always strictly positive. source_id is
-- not a FK (polymorphic); owner-scoping is enforced via the account_id
-- composite FK and the originating operation's own FKs.
CREATE TABLE account_movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL,
  direction TEXT NOT NULL
    CHECK (direction IN ('debit', 'credit')),
  amount_cents BIGINT NOT NULL
    CHECK (amount_cents > 0 AND amount_cents <= 9007199254740991),
  source_type TEXT NOT NULL
    CHECK (source_type IN ('settlement', 'receipt', 'adjustment', 'transfer')),
  source_id BIGINT,
  business_date DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  FOREIGN KEY (owner_id, account_id)
    REFERENCES accounts (owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX account_movements_owner_account_recorded_idx
  ON account_movements (owner_id, account_id, recorded_at);
CREATE INDEX account_movements_owner_date_idx
  ON account_movements (owner_id, business_date);

-- balance_adjustments: manual balance refresh replaces (not adds) the current
-- balance. Records old balance, new balance, signed difference and as-of
-- timestamp. Protects against concurrent payments using the account's version
-- column (optimistic concurrency).
CREATE TABLE balance_adjustments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL,
  old_balance_cents BIGINT
    CHECK (old_balance_cents IS NULL
      OR (old_balance_cents >= -9007199254740991
        AND old_balance_cents <= 9007199254740991)),
  new_balance_cents BIGINT NOT NULL
    CHECK (new_balance_cents >= -9007199254740991
      AND new_balance_cents <= 9007199254740991),
  difference_cents BIGINT NOT NULL
    CHECK (difference_cents >= -9007199254740991
      AND difference_cents <= 9007199254740991),
  as_of TIMESTAMPTZ NOT NULL,
  reason TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  FOREIGN KEY (owner_id, account_id)
    REFERENCES accounts (owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX balance_adjustments_owner_account_recorded_idx
  ON balance_adjustments (owner_id, account_id, recorded_at);

-- internal_transfers: transfers between two accounts of the same owner. Not
-- income or expenses. Change individual account balances but not the total B /
-- forecast. Create two account_movements rows (debit from, credit to).
CREATE TABLE internal_transfers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  from_account_id BIGINT NOT NULL,
  to_account_id BIGINT NOT NULL,
  amount_cents BIGINT NOT NULL
    CHECK (amount_cents > 0 AND amount_cents <= 9007199254740991),
  business_date DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  FOREIGN KEY (owner_id, from_account_id)
    REFERENCES accounts (owner_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, to_account_id)
    REFERENCES accounts (owner_id, id) ON DELETE RESTRICT,
  CHECK (from_account_id <> to_account_id)
);

CREATE INDEX internal_transfers_owner_from_idx
  ON internal_transfers (owner_id, from_account_id);
CREATE INDEX internal_transfers_owner_to_idx
  ON internal_transfers (owner_id, to_account_id);

-- operation_log: idempotency key tracking with payload identity. An operation
-- is identified by (owner_id, operation_key). A retry with the same key and a
-- matching payload hash is idempotent. A retry with the same key but a changed
-- payload hash is rejected.
CREATE TABLE operation_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  operation_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, operation_key)
);

CREATE INDEX operation_log_owner_type_created_idx
  ON operation_log (owner_id, operation_type, created_at);

-- closing_snapshots: immutable month-end snapshots. Once a month is closed,
-- its snapshot records balances, forecast inputs/outputs, savings target and
-- settlement totals. Later months cannot rewrite a closed snapshot.
CREATE TABLE closing_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  month_key TEXT NOT NULL
    CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  balances_total_cents BIGINT NOT NULL
    CHECK (balances_total_cents >= -9007199254740991
      AND balances_total_cents <= 9007199254740991),
  pending_income_remaining_cents BIGINT NOT NULL
    CHECK (pending_income_remaining_cents >= 0
      AND pending_income_remaining_cents <= 9007199254740991),
  ordinary_unpaid_cents BIGINT NOT NULL
    CHECK (ordinary_unpaid_cents >= 0
      AND ordinary_unpaid_cents <= 9007199254740991),
  reserved_outstanding_cents BIGINT NOT NULL
    CHECK (reserved_outstanding_cents >= 0
      AND reserved_outstanding_cents <= 9007199254740991),
  savings_target_cents BIGINT NOT NULL
    CHECK (savings_target_cents >= 0
      AND savings_target_cents <= 9007199254740991),
  projected_free_to_spend_cents BIGINT
    CHECK (projected_free_to_spend_cents IS NULL
      OR (projected_free_to_spend_cents >= -9007199254740991
        AND projected_free_to_spend_cents <= 9007199254740991)),
  cash_backed_free_to_spend_cents BIGINT
    CHECK (cash_backed_free_to_spend_cents IS NULL
      OR (cash_backed_free_to_spend_cents >= -9007199254740991
        AND cash_backed_free_to_spend_cents <= 9007199254740991)),
  settlement_total_cents BIGINT NOT NULL
    CHECK (settlement_total_cents >= 0
      AND settlement_total_cents <= 9007199254740991),
  closed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, month_key),
  FOREIGN KEY (owner_id, month_key)
    REFERENCES monthly_plans (owner_id, month_key) ON DELETE RESTRICT
);

-- audit_log: general audit trail for privileged/sensitive operations
-- (provisioning, balance adjustments, rollover apply, closing, reversals).
-- Records the operation type, entity reference, a safe summary and timestamp.
-- Does not store secrets or raw payloads.
CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id BIGINT,
  summary TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id)
);

CREATE INDEX audit_log_owner_recorded_idx
  ON audit_log (owner_id, recorded_at);
CREATE INDEX audit_log_owner_type_idx
  ON audit_log (owner_id, operation_type);