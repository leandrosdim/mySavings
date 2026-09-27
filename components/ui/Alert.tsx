"use client";

import type { ReactNode, CSSProperties } from "react";
import { errorTextStyle } from "./styles";

type AlertProps = {
  children: ReactNode;
  tone?: "error" | "warning" | "info";
  style?: CSSProperties;
};

const tones: Record<NonNullable<AlertProps["tone"]>, CSSProperties> = {
  error: {
    color: "#b91c1c",
    backgroundColor: "#fef2f2",
    border: "1px solid #fecaca",
  },
  warning: {
    color: "var(--warning)",
    backgroundColor: "#fffbeb",
    border: "1px solid #fde68a",
  },
  info: {
    color: "var(--muted)",
    backgroundColor: "var(--card)",
    border: "1px solid var(--border)",
  },
};

export function Alert({ children, tone = "error", style }: AlertProps) {
  return (
    <div
      role="alert"
      style={{
        ...errorTextStyle,
        fontSize: "0.85rem",
        lineHeight: 1.5,
        borderRadius: "0.6rem",
        padding: "0.6rem 0.75rem",
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </div>
  );
}