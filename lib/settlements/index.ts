// Public API barrel for the settlement service.

export type {
  Settlement,
  Receipt,
  SettlementId,
  ReceiptId,
  AccountId,
  ObligationId,
  IncomeId,
  SettlementMode,
  PayInput,
  PayResult,
  ReceiveInput,
  ReceiveResult,
  ReverseSettlementInput,
  ReverseSettlementResult,
  ReverseReceiptInput,
  ReverseReceiptResult,
  SettlementHistoryEntry,
  ReceiptHistoryEntry,
  OwnerId,
} from "./types";

export {
  SettlementServiceError,
  SettlementValidationError,
  SettlementNotFoundError,
  SettlementConflictError,
  IdempotencyConflictError,
  OverpaymentError,
  ClosedMonthError,
  AlreadyReversedError,
  RefreshReconciliationRequiredError,
} from "./types";

export {
  payObligation,
  receiveIncome,
  reverseSettlement,
  reverseReceipt,
  getSettlement,
  getReceipt,
  listSettlementsForObligation,
  listReceiptsForIncome,
} from "./service";

export {
  validateObligationId,
  validateIncomeId,
  validateSettlementId,
  validateReceiptId,
  validateOptionalAccountId,
  validateMode,
  validateAmountCents,
  validateBusinessDate,
  validateIdempotencyKey,
  validateOptionalReason,
  validatePayInput,
  validateReceiveInput,
  validateReverseSettlementInput,
  validateReverseReceiptInput,
} from "./validation";