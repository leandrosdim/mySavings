// Public API barrel for the obligation service.

export type {
  Obligation,
  ObligationId,
  ObligationKind,
  ObligationStatus,
  CreateObligationInput,
  CreateObligationResult,
  UpdateObligationInput,
  UpdateObligationResult,
  CancelObligationResult,
  ReleaseObligationResult,
  ObligationFilter,
  OwnerId,
  MonthKey,
} from "./types";

export {
  ObligationServiceError,
  ObligationValidationError,
  ObligationNotFoundError,
  ObligationConflictError,
  ClosedMonthError,
  SettledHistoryError,
} from "./types";

export {
  createObligation,
  getObligation,
  listObligations,
  updateObligation,
  cancelObligation,
  releaseObligation,
} from "./service";

export {
  validateTitle,
  validateKind,
  validatePlannedCents,
  validateMonthKey,
  validateOptionalDate,
  validateOptionalAccountId,
  validateObligationId,
  validateCreateObligationInput,
  validateUpdateObligationInput,
} from "./validation";