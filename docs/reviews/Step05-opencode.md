# Step05 — implementer self-report

Project: /home/leandrosdim777/projects/mySavings
Model: ollama-cloud/glm-5.2
Date: 2026-09-26

This is the implementer's self-report for Step05 (owner-scoped financial
schema). It is NOT independent approval. Hermes reviews independently. No
commits/pushes/deployment/production migrations/public writes were performed.

## Scope

Only Step05: owner-scoped financial schema (accounts, monthly plans, recurring
templates, obligations, income expectations, settlements, reversals, account
movements, balance adjustments, internal transfers, operation log, closing
snapshots, audit log). No CRUD API/UI, no live-data import, no Step06.

## Prerequisites verified

- Step04 independently verified (docs/reviews/Step04.md): private authentication
  and identity. users.id is BIGINT GENERATED ALWAYS AS IDENTITY. Transaction
  conventions: `withTransaction(async (client) => ...)` in lib/db.ts, explicit
  BEGIN/COMMIT/ROLLBACK on one checked-out client for writes.
- Existing migrations: 0001_schema_migrations.sql, 0002_identity.sql. Next
  unused migration number: 0003.
- Step05 prompt copies (steps/Step05.md and prompts/Step05-opencode-glm52.md)
  are in sync.
- git status clean before work; no unrelated changes.

## Files created

- `db/migrations/0003_finance.sql` — 15 owner-scoped financial tables with
  composite FKs, CHECK constraints, unique indexes and idempotency keys.
- `docs/schema.md` — entity documentation, relationships, invariants, indexes.
- `tests/db/schema.test.ts` — 41 DB integration tests against disposable
  step05_* schemas with two synthetic users (A and B).

## Files modified

- `tests/db/helpers.ts` — added `step05` prefix to the disposable-schema drop
  guard (one line, same pattern as existing step03/step04 guards).

## Schema decisions

### Owner-aware composite foreign keys

Every cross-entity relation uses `FOREIGN KEY (owner_id, entity_id)
REFERENCES target(owner_id, id)`. The referenced table declares
`UNIQUE (owner_id, id)` as the FK target. This prevents owner A from
referencing owner B's account, obligation, template, income, settlement,
receipt, movement, adjustment or transfer — even with direct SQL. Tested with
6 cross-owner isolation tests (settlement against B's obligation, settlement
using B's account, transfer to B's account, obligation linking B's account,
obligation linking B's reserve, closing snapshot for B's month).

### Money bounds

All cents columns are BIGINT with CHECK constraints bounding to
±9007199254740991 (Number.MAX_SAFE_INTEGER). This guarantees any value read
from the DB can be converted to a JS number without precision loss. Tested at
boundary values (exactly MAX_SAFE_INTEGER accepted, MAX_SAFE_INTEGER + 1
rejected, -MAX_SAFE_INTEGER accepted, -MAX_SAFE_INTEGER - 1 rejected).

### Month key validation

month_key CHECK uses POSIX regex `^[0-9]{4}-(0[1-9]|1[0-2])$` (not `\d` which
is not supported in PostgreSQL's POSIX regex; not `[0-9]{2}` which would allow
month 13). Validates both format and month range 01-12.

### Mode/account consistency

Settlements and receipts with `mode = 'UPDATE_ACCOUNT'` require `account_id IS
NOT NULL` via a CHECK constraint. `ALREADY_REFLECTED` mode allows NULL
account_id. Tested both paths.

### Paid history survives (ON DELETE RESTRICT)

Cross-entity FKs to accounts and obligations use `ON DELETE RESTRICT` so
deleting an entity with settlements/movements fails. User deletion cascades
through `owner_id` FKs (`ON DELETE CASCADE`). Tested: cannot delete account
with movements, cannot delete obligation with settlements, user deletion
cascades to all finance tables.

### Idempotency

`UNIQUE (owner_id, idempotency_key)` on settlements, receipts, reversals,
adjustments, transfers. `UNIQUE (owner_id, operation_key)` on operation_log.
Same key for different owners is allowed (tested). Duplicate key for same
owner is rejected (tested).

### Template generation uniqueness

Partial unique index `(owner_id, origin_template_id, original_month_key)
WHERE origin_template_id IS NOT NULL` on obligations and income_expectations.
Ensures a template generates at most one obligation/income per month. Same
template in a different month is allowed (tested).

### Deferred to Step10 (transaction logic)

Overpayment rejection across multiple settlement rows, atomic
payment/movement/audit, and balance-effect reconciliation after post-refresh
reversal require transactional row-locking, not static CHECK constraints. The
schema stores the data; Step10 enforces these rules.

## Quality gates

| Gate | Result |
|------|--------|
| `npm run lint` | Pass (0 errors, 0 warnings) |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | Pass |
| `npm test` (offline) | Pass: 7 files, 309 tests |
| `DB_TEST_ALLOW_WRITES=1 npm run test:db` (full DB suite) | Pass: 17 files, 506 tests |
| `npm run build` | Pass (Next.js 16.3.5, Turbopack) |
| `npm audit` | 0 vulnerabilities |
| `git diff --check` | Clean |
| Migration scanner (`assertTransactionSafe`) | Pass (no top-level transaction control or session overrides) |

New schema test count: 41 tests in tests/db/schema.test.ts.
Full DB suite went from 465 to 506 tests (+41).
Offline suite unchanged at 309 tests.

## Migration idempotence

The real migration runner applies 0001 + 0002 + 0003 into each disposable
step05_* schema. A second run skips all 3 (tested: applied=0, skipped=3).

## Test infrastructure

Schema tests follow the existing tests/auth/helpers.ts pattern: disposable
uniquely-named step05_* schemas on the approved test DB, direct (unpooled)
endpoint with startup search_path, two synthetic users provisioned via direct
SQL. All fixture writes use explicit transactions (txn helper with
BEGIN/COMMIT/ROLLBACK on one checked-out client). Scoped cleanup in
afterAll/teardownSchemaContext.

## Boundaries kept

- No commits/pushes/deployment/production migrations/public writes.
- No global configuration edits.
- No edits to independent review files or steps/registry.json.
- No new features beyond the Step05 schema scope.
- No real data import; all fixtures are synthetic @step05.test.local emails
  in disposable step05_* schemas, cleaned up in teardown.
- No UI changes (Step05 is schema-only; no CRUD API/UI).

## Remaining risks / deferred items

1. Overpayment prevention is deferred to Step10 (requires transactional
   row-locking, not a static CHECK).
2. Atomic payment/movement/audit is deferred to Step10.
3. Balance-effect reconciliation after post-refresh reversal is deferred to
   Step10.
4. The `linked_reserve_id` self-referencing FK does not yet enforce that the
   target has `kind = 'reserved'` via a trigger; this is application logic in
   Step10/Step12. The composite FK prevents cross-owner linking but not
   kind mismatch within the same owner.
5. No CRUD API/UI yet — Step06 onwards.
6. The vitest DEPRECATED warning for `test.poolOptions` is pre-existing
   (vitest.db.config.mts) and not introduced by Step05.

## STOP

Step05 owner-scoped financial schema implemented and self-verified. Awaiting
independent Hermes review. No next step started.