"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/auth/actions";
import type { LoginState } from "@/lib/auth/types";

const inputStyle: React.CSSProperties = {
  minHeight: "2.75rem",
  padding: "0.55rem 0.7rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--border)",
  fontSize: "1rem",
  color: "var(--fg)",
  backgroundColor: "var(--card)",
  width: "100%",
};

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    loginAction,
    undefined,
  );

  return (
    <main
      style={{
        maxWidth: "24rem",
        margin: "0 auto",
        padding: "1.5rem 1rem 3rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.1rem",
        minHeight: "100dvh",
        justifyContent: "center",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <h1
          style={{
            fontSize: "1.45rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          mySavings
        </h1>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--muted)" }}>
          Sign in to your private workspace.
        </p>
      </header>

      <form
        action={formAction}
        style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
        autoComplete="on"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <label
            htmlFor="email"
            style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--fg)" }}
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <label
            htmlFor="password"
            style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--fg)" }}
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            maxLength={256}
            style={inputStyle}
          />
        </div>

        {state?.ok === false && (
          <p
            role="alert"
            style={{
              margin: 0,
              fontSize: "0.85rem",
              color: "#b91c1c",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "0.5rem",
              padding: "0.5rem 0.65rem",
            }}
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          style={{
            minHeight: "2.75rem",
            padding: "0.6rem 1.1rem",
            borderRadius: "0.6rem",
            backgroundColor: "var(--accent)",
            color: "white",
            fontWeight: 600,
            fontSize: "0.95rem",
            border: "none",
            cursor: pending ? "not-allowed" : "pointer",
            opacity: pending ? 0.7 : 1,
          }}
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}