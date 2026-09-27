// Recurring template service public API.
//
// Route handlers and server actions import from this barrel. The service
// layer (service.ts) is server-only; validation.ts is pure and safe for
// reuse in tests.

export type {
  RecurringTemplate,
  TemplateId,
  TemplateKind,
  OwnerId,
  CreateTemplateInput,
  CreateTemplateResult,
  UpdateTemplateInput,
  UpdateTemplateResult,
} from "./types";

export {
  TemplateServiceError,
  TemplateValidationError,
  TemplateNotFoundError,
  TemplateConflictError,
} from "./types";

export {
  createTemplate,
  getTemplate,
  listTemplates,
  listActiveTemplates,
  updateTemplate,
  deleteTemplate,
} from "./service";

export {
  validateTemplateName,
  validateTemplateKind,
  validateDefaultAmount,
  validateDueDayOfMonth,
  validateActive,
  validateTemplateId,
  validateCreateTemplateInput,
  validateUpdateTemplateInput,
} from "./validation";