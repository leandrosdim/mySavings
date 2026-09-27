"use client";

import type { ReactNode } from "react";
import { useId } from "react";
import { Input } from "./Input";
import { labelStyle, hintStyle, errorTextStyle } from "./styles";

type FieldProps = {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  invalid?: boolean;
  children?: ReactNode;
};

export function Field({
  label,
  htmlFor,
  hint,
  error,
  invalid,
  children,
}: FieldProps) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      {children ?? <Input id={id} invalid={invalid} />}
      {error ? (
        <p role="alert" style={errorTextStyle}>
          {error}
        </p>
      ) : hint ? (
        <p style={hintStyle}>{hint}</p>
      ) : null}
    </div>
  );
}