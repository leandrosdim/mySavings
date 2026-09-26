export type LoginState =
  | { ok: true }
  | { ok: false; error: string }
  | undefined;