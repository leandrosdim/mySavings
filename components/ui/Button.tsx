"use client";

import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from "react";
import { primaryButton, secondaryButton, dangerButton } from "./styles";
import { setPwaUpdateBlocked } from "@/components/pwa/UpdateAvailable";

type Variant = "primary" | "secondary" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  pending?: boolean;
};

function mergeStyle(
  variant: Variant,
  pending: boolean,
  style?: CSSProperties,
): CSSProperties {
  const base =
    variant === "primary"
      ? primaryButton
      : variant === "danger"
        ? dangerButton
        : secondaryButton;
  return {
    ...base,
    ...(pending
      ? { opacity: 0.6, cursor: "not-allowed", pointerEvents: "none" }
      : {}),
    ...style,
  };
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      pending = false,
      style,
      children,
      disabled,
      type = "button",
      ...rest
    },
    ref,
  ) {
    // Mirror pending into the global PWA update-block flag so the update
    // toast's reload button is disabled while a financial submission is in
    // flight. Reload is never forced; this only makes the manual reload
    // button unavailable during entry.
    useEffect(() => {
      setPwaUpdateBlocked(pending);
      return () => {
        setPwaUpdateBlocked(false);
      };
    }, [pending]);
    return (
      <button
        ref={ref}
        type={type}
        style={mergeStyle(variant, pending, style)}
        disabled={disabled || pending}
        {...rest}
      >
        {children}
      </button>
    );
  },
);