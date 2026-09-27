// Monthly plan service public API.
//
// Route handlers and server actions import from this barrel. The service
// layer (service.ts) is server-only; validation.ts is pure and safe for
// reuse in tests.

export type {
  MonthlyPlan,
  OwnerId,
  PlanId,
  MonthKey,
  CreatePlanInput,
  CreatePlanResult,
  UpdateTargetInput,
  UpdateTargetResult,
  GenerationResult,
} from "./types";

export {
  PlanServiceError,
  PlanValidationError,
  PlanNotFoundError,
  PlanConflictError,
  ClosedMonthError,
} from "./types";

export {
  createPlan,
  getOrCreatePlan,
  getPlan,
  getPlanByMonth,
  listPlans,
  updateSavingsTarget,
  currentMonthKeyAthens,
  nextMonthKey,
  prevMonthKey,
  monthKeyFromAthensDate,
} from "./service";

export {
  validateMonthKey,
  validateSavingsTarget,
  validatePlanId,
  validateCreatePlanInput,
  validateUpdateTargetInput,
} from "./validation";