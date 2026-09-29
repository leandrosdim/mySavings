-- Step15 month closing, history and private exports.
--
-- The closing_snapshots table from 0003 already stores the aggregate forecast
-- inputs/outputs (balances total, I/E/R, savings target, projected and
-- cash-backed free-to-spend, settlement total) plus closed_at. Two pieces are
-- still needed for honest historical comparison and provenance:
--
-- 1. balances_as_of: the freshness marker of the balances that were used to
--    build the snapshot at close time. A later account refresh cannot alter a
--    closed snapshot; storing the as-of timestamp lets the history UI show
--    "balances as of <time>" for a closed month instead of today's freshness.
--    NULLable because an owner may close a month before ever entering a balance
--    (setup-incomplete snapshot); the aggregate balances_total_cents already
--    captures 0 in that case and the forecast outputs are NULL.
-- 2. provenance: a JSONB record of the per-account balances, per-obligation
--    (planned/paid/remaining) and per-income (expected/received/pending)
--    breakdown used to compute the snapshot aggregates. This is immutable
--    provenance, not a live re-derivation: later payments/refreshes/releases
--    cannot rewrite it. It supports the historical detail/comparison view
--    without reconstructing from today's live balances. NULLable for an
--    empty/setup-incomplete close (no accounts/obligations/income).
--
-- These columns are additive (no existing column is altered or dropped) so the
-- migration is safe to apply on top of the already-applied 0003 ledger. The
-- UNIQUE(owner_id, month_key) and FK to monthly_plans are unchanged.
--
-- All money in provenance is stored as integer cents inside the JSONB; no
-- floating-point financial arithmetic. The JSONB is read-only provenance and is
-- never used as a settlement/payment source of truth — those stay in the
-- immutable settlements/income_receipts tables. Provenance is a point-in-time
-- copy for the history view only.

ALTER TABLE closing_snapshots
  ADD COLUMN balances_as_of TIMESTAMPTZ,
  ADD COLUMN provenance JSONB;