export function redirect(url: string): never {
  const error = new Error(`NEXT_REDIRECT: ${url}`);
  (error as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
  throw error;
}

export function notFound(): never {
  const error = new Error("NEXT_NOT_FOUND");
  (error as Error & { digest: string }).digest = "NEXT_NOT_FOUND;404";
  throw error;
}

export function permanentRedirect(url: string): never {
  const error = new Error(`NEXT_REDIRECT: ${url}`);
  (error as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${url};308;`;
  throw error;
}

export const RedirectType = {
  push: "push",
  replace: "replace",
} as const;