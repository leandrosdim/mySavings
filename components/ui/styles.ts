// Shared design tokens for inline-styled UI primitives.
//
// The project uses inline styles (no CSS modules) and Tailwind v4 only for the
// base reset. These tokens keep the primitives consistent without introducing
// a CSS-in-JS layer. All touch targets meet the >=44px requirement.

import type { CSSProperties } from "react";

export const touchTarget: CSSProperties = {
  minHeight: "2.75rem",
  minWidth: "2.75rem",
};

export const inputBase: CSSProperties = {
  ...touchTarget,
  width: "100%",
  padding: "0.55rem 0.7rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--border)",
  fontSize: "1rem",
  color: "var(--fg)",
  backgroundColor: "var(--card)",
  lineHeight: 1.4,
};

export const inputError: CSSProperties = {
  borderColor: "#dc2626",
};

export const labelStyle: CSSProperties = {
  fontSize: "0.85rem",
  fontWeight: 600,
  color: "var(--fg)",
  display: "block",
};

export const hintStyle: CSSProperties = {
  fontSize: "0.82rem",
  color: "var(--muted)",
  lineHeight: 1.4,
};

export const errorTextStyle: CSSProperties = {
  fontSize: "0.82rem",
  color: "#b91c1c",
  lineHeight: 1.4,
};

export const cardStyle: CSSProperties = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "0.8rem",
  padding: "1rem 1.05rem",
};

export const primaryButton: CSSProperties = {
  ...touchTarget,
  padding: "0.6rem 1.1rem",
  borderRadius: "0.6rem",
  backgroundColor: "var(--accent)",
  color: "white",
  fontWeight: 600,
  fontSize: "0.95rem",
  border: "none",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4rem",
};

export const secondaryButton: CSSProperties = {
  ...touchTarget,
  padding: "0.6rem 1.1rem",
  borderRadius: "0.6rem",
  backgroundColor: "var(--card)",
  color: "var(--fg)",
  fontWeight: 600,
  fontSize: "0.95rem",
  border: "1px solid var(--border)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4rem",
};

export const dangerButton: CSSProperties = {
  ...touchTarget,
  padding: "0.6rem 1.1rem",
  borderRadius: "0.6rem",
  backgroundColor: "var(--card)",
  color: "#b91c1c",
  fontWeight: 600,
  fontSize: "0.95rem",
  border: "1px solid #fecaca",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4rem",
};

export const pageMaxWidth: CSSProperties = {
  maxWidth: "30rem",
  margin: "0 auto",
  padding: "1.25rem 1rem calc(2rem + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: "1.2rem",
};

export const stickyControls: CSSProperties = {
  position: "sticky",
  bottom: 0,
  backgroundColor: "var(--bg)",
  paddingBottom: "env(safe-area-inset-bottom)",
  paddingTop: "0.75rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.6rem",
};

export const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.5)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  zIndex: 50,
};

export const sheetStyle: CSSProperties = {
  backgroundColor: "var(--card)",
  borderRadius: "0.9rem 0.9rem 0 0",
  width: "100%",
  maxWidth: "30rem",
  maxHeight: "90dvh",
  overflowY: "auto",
  padding:
    "1rem 1.05rem calc(1rem + env(safe-area-inset-bottom))",
  display: "flex",
  flexDirection: "column",
  gap: "0.85rem",
  boxShadow: "0 -4px 24px rgba(0,0,0,0.15)",
};

export const dividerStyle: CSSProperties = {
  border: "none",
  borderTop: "1px solid var(--border)",
  margin: 0,
};