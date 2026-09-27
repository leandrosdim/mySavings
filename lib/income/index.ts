// Public API barrel for the income expectation service.

export type {
  IncomeExpectation,
  IncomeId,
  IncomeStatus,
  CreateIncomeInput,
  CreateIncomeResult,
  UpdateIncomeInput,
  UpdateIncomeResult,
  CancelIncomeResult,
  IncomeFilter,
  OwnerId,
  MonthKey,
} from "./types";

export {
  IncomeServiceError,
  IncomeValidationError,
  IncomeNotFoundError,
  IncomeConflictError,
  IncomeClosedMonthError,
  ReceiptHistoryError,
} from "./types";

export {
  createIncome,
  getIncome,
  listIncome,
  updateIncome,
  cancelIncome,
} from "./service";

export {
  validateSourceName,
  validateExpectedCents,
  validateMonthKey,
  validateOptionalAccountId,
  validateIncomeId,
  validateCreateIncomeInput,
  validateUpdateIncomeInput,
} from "./validation";