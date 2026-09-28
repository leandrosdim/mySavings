// Month rollover service public API.
//
// Route handlers and server components import from this barrel. The service
// layer (service.ts) is server-only; validation.ts is pure and safe for reuse
// in tests.

export type {
  RolloverPreview,
  ApplyRolloverInput,
  ApplyRolloverResult,
  CarryoverObligationPreview,
  RecurringInstancePreview,
  ReservedCarryoverPreview,
  UnresolvedIncomePreview,
  ReleaseChoice,
  OwnerId,
  MonthKey,
  Cents,
} from "./types";

export {
  RolloverServiceError,
  RolloverValidationError,
  RolloverConflictError,
  RolloverClosedMonthError,
  RolloverStalePreviewError,
  RolloverIdempotencyConflictError,
} from "./types";

export { buildRolloverPreview, applyRollover } from "./service";

export {
  validateApplyRolloverInput,
  validateRolloverMonthKey,
  validatePreviewDigest,
  validateIdempotencyKey,
  validateObligationId,
  validateIncomeId,
} from "./validation";