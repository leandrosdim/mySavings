"use client";

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from "react";
import { primaryButton, secondaryButton, dangerButton } from "./styles";

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
    { variant = "primary", pending = false, style, children, disabled, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        style={mergeStyle(variant, pending, style)}
        disabled={disabled || pending}
        {...rest}
      >
        {children}
      </button>
    );
  },
);