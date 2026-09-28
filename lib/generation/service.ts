// Month entry generation service: idempotently generate obligations and
// income expectations from active recurring templates for a given month.
//
// All functions take an ownerId derived from the verified server session.
// Every write uses withTransaction (explicit BEGIN/COMMIT/ROLLBACK on one
// checked-out client).
//
// Key invariants enforced here:
// - Generation is idempotent: running it twice for the same owner+month
//   produces no duplicates. This is enforced by the partial unique indexes:
//   obligations(owner_id, origin_template_id, original_month_key) WHERE
//   origin_template_id IS NOT NULL, and
//   income_expectations(owner_id, origin_template_id, month_key) WHERE
//   origin_template_id IS NOT NULL.
// - Editing a template does not rewrite prior instances. The generated
//   obligation/income keeps the template's amount at generation time; the
//   obligation's planned_cents is immutable.
// - Templates themselves do not enter E or I. They generate obligations
//   (ordinary/reserved) or income_expectations (income) which are the
//   actual entries.
// - A plan must exist for the month before generation (FK constraint on
//   obligations.current_month_key and income_expectations.month_key).
// - Due day is used as a presentation hint for due_date; it does not
//   multiply the amount. A weekly spending allowance is entered as a
//   monthly budget, not silently multiplied by an assumed four weeks.

import "server-only";
import { withTransaction, type PoolClient } from "../db";
import type { OwnerId, MonthKey } from "../months/types";
import {
  getOrCreatePlan,
  currentMonthKeyAthens,
} from "../months/service";
import { listActiveTemplates } from "../templates/service";
import type { RecurringTemplate } from "../templates/types";
import type { GenerationResult } from "../months/types";

export type { GenerationResult, MonthKey, OwnerId };

// --- Row types ---

type ObligationRow = { id: string };
type IncomeRow = { id: string };

// --- Generation ---

/**
 * Generate month entries from all active templates for the given month.
 *
 * If monthKey is not provided, uses the current Europe/Athens month.
 * If no plan exists for the month, one is created with savings target 0.
 *
 * Returns counts of generated and skipped (already existed) entries.
 * Idempotent: running twice produces no duplicates.
 */
export async function generateMonthEntries(
  ownerId: OwnerId,
  monthKey?: MonthKey,
): Promise<GenerationResult> {
  const key = monthKey ?? currentMonthKeyAthens();
  const { plan } = await getOrCreatePlan(ownerId, key, 0);
  const templates = await listActiveTemplates(ownerId);

  if (templates.length === 0) {
    return {
      planId: plan.id,
      monthKey: key,
      generatedObligations: 0,
      generatedIncome: 0,
      skippedObligations: 0,
      skippedIncome: 0,
    };
  }

  const counts = await withTransaction(async (client) => {
    return generateFromTemplates(client, ownerId, key, templates);
  });

  return {
    planId: plan.id,
    monthKey: key,
    ...counts,
  };
}

/**
 * Generate month entries from a pre-loaded template list inside an existing
 * transaction client. Used by the rollover apply path so generation and
 * carryover share one atomic transaction. Idempotent per template via the
 * partial unique indexes on obligations/income_expectations.
 */
export async function generateFromTemplates(
  client: PoolClient,
  ownerId: OwnerId,
  monthKey: MonthKey,
  templates: RecurringTemplate[],
): Promise<{
  generatedObligations: number;
  generatedIncome: number;
  skippedObligations: number;
  skippedIncome: number;
}> {
  let generatedObligations = 0;
  let generatedIncome = 0;
  let skippedObligations = 0;
  let skippedIncome = 0;

  for (const template of templates) {
    if (template.kind === "income") {
      const result = await generateIncomeFromTemplate(
        client,
        ownerId,
        monthKey,
        template,
      );
      if (result === "generated") generatedIncome++;
      else skippedIncome++;
    } else {
      const result = await generateObligationFromTemplate(
        client,
        ownerId,
        monthKey,
        template,
      );
      if (result === "generated") generatedObligations++;
      else skippedObligations++;
    }
  }

  return {
    generatedObligations,
    generatedIncome,
    skippedObligations,
    skippedIncome,
  };
}

/**
 * Generate a single income expectation from a template for the given month.
 * Idempotent: the partial unique index on income_expectations ensures no
 * duplicate. Returns "generated" or "skipped".
 */
async function generateIncomeFromTemplate(
  client: PoolClient,
  ownerId: OwnerId,
  monthKey: MonthKey,
  template: RecurringTemplate,
): Promise<"generated" | "skipped"> {
  const spName = `sp_gen_income_${template.id}`;
  try {
    await client.query(`SAVEPOINT ${spName}`);
    await client.query<IncomeRow>(
      `INSERT INTO income_expectations
         (owner_id, month_key, source_name, expected_cents,
          origin_template_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING id`,
      [ownerId, monthKey, template.name, template.defaultAmountCents, template.id],
    );
    return "generated";
  } catch (error) {
    await client.query(`ROLLBACK TO ${spName}`);
    if (isUniqueViolation(error)) {
      return "skipped";
    }
    throw error;
  }
}

/**
 * Generate a single obligation from a template for the given month.
 * Idempotent: the partial unique index on obligations ensures no duplicate.
 * Returns "generated" or "skipped".
 */
async function generateObligationFromTemplate(
  client: PoolClient,
  ownerId: OwnerId,
  monthKey: MonthKey,
  template: RecurringTemplate,
): Promise<"generated" | "skipped"> {
  const kind = template.kind === "reserved" ? "reserved" : "ordinary";
  const spName = `sp_gen_obl_${template.id}`;
  try {
    await client.query(`SAVEPOINT ${spName}`);
    await client.query<ObligationRow>(
      `INSERT INTO obligations
         (owner_id, kind, title, planned_cents, original_month_key,
          current_month_key, due_date, origin_template_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
       RETURNING id`,
      [
        ownerId,
        kind,
        template.name,
        template.defaultAmountCents,
        monthKey,
        monthKey,
        computeDueDate(monthKey, template.dueDayOfMonth),
        template.id,
      ],
    );
    return "generated";
  } catch (error) {
    await client.query(`ROLLBACK TO ${spName}`);
    if (isUniqueViolation(error)) {
      return "skipped";
    }
    throw error;
  }
}

/**
 * Compute a due DATE for the given month key and due day.
 * If the due day exceeds the month's last day, clamp to the last day.
 * Returns a JS Date at noon UTC (same as parseBusinessDate pattern).
 */
function computeDueDate(monthKey: MonthKey, dueDay: number | null): Date | null {
  if (dueDay === null) return null;
  const parts = monthKey.split("-");
  const year = Number.parseInt(parts[0], 10);
  const month = Number.parseInt(parts[1], 10);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDay);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function isUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;
    return code === "23505";
  }
  return false;
}