type CookieMap = Map<string, string>;

let store: CookieMap = new Map();

// Test-only failure injection. When setFailOnWrite(true) is active, set()
// throws to simulate a cookie-store write failure (e.g. oversized cookie or
// sealed-secret error). Tests use this to exercise the CookieSaveError path.
let failOnWrite = false;

// Test-only failure injection. When setFailOnInit(true) is active, cookies()
// rejects to simulate iron-session initialization failure (e.g. malformed
// cookie store, internal getIronSession error). Tests use this to exercise
// the init-failure cleanup path in createSessionWithCredentialCheck.
let failOnInit = false;

export function __setFailOnWrite(on: boolean): void {
  failOnWrite = on;
}

export function __setFailOnInit(on: boolean): void {
  failOnInit = on;
}

export function __resetCookieStore() {
  store = new Map();
  failOnWrite = false;
  failOnInit = false;
}

export function __setCookie(name: string, value: string) {
  store.set(name, value);
}

export function __getCookie(name: string): string | undefined {
  return store.get(name);
}

const ReadOnlyHeaders = {
  get(name: string): string | undefined {
    return undefined;
  },
  entries() {
    return [] as Array<[string, string]>;
  },
};

export async function cookies() {
  if (failOnInit) {
    throw new Error("simulated cookie store initialization failure");
  }
  return {
    get(name: string): { name: string; value: string } | undefined {
      const value = store.get(name);
      if (value === undefined) return undefined;
      return { name, value };
    },
    getAll(): Array<{ name: string; value: string }> {
      return Array.from(store.entries()).map(([name, value]) => ({ name, value }));
    },
    set(...args: [string, string] | [{ name: string; value: string }]): void {
      if (failOnWrite) {
        throw new Error("simulated cookie write failure");
      }
      if (args.length === 1) {
        store.set(args[0].name, args[0].value);
      } else {
        store.set(args[0], args[1]);
      }
    },
    delete(name: string): void {
      store.delete(name);
    },
    has(name: string): boolean {
      return store.has(name);
    },
    clear(): void {
      store.clear();
    },
  };
}

export async function headers() {
  return ReadOnlyHeaders;
}