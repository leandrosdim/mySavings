// Account service public API.
//
// Route handlers and server actions import from this barrel. The service
// layer (service.ts) is server-only; validation.ts is pure and safe for
// reuse in tests.

export type {
  Account,
  OwnerId,
  AccountId,
  TransferId,
  AdjustmentId,
  CreateAccountInput,
  CreateAccountResult,
  RenameAccountResult,
  ArchiveAccountResult,
  BalanceRefreshResult,
  RefreshBalanceInput,
  TransferInput,
  TransferResult,
} from "./types";

export {
  AccountServiceError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ArchiveRestrictedError,
  IdempotencyConflictError,
} from "./types";

export {
  createAccount,
  listAccounts,
  listAllAccounts,
  getAccount,
  renameAccount,
  archiveAccount,
  refreshBalance,
  transferBetweenAccounts,
  getReconciliationState,
  parseBusinessDate,
} from "./service";

export {
  validateAccountName,
  validateAccountId,
  validateOptionalBalance,
  validatePositiveCents,
  validateBalanceCents,
  validateBusinessDate,
  validateIdempotencyKey,
  validateOptionalReason,
  validateExpectedVersion,
  validateCreateAccountInput,
  validateRefreshBalanceInput,
  validateTransferInput,
  validateAsOfDate,
} from "./validation";