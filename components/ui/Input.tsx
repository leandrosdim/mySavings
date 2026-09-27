"use client";

import {
  forwardRef,
  type InputHTMLAttributes,
  type CSSProperties,
} from "react";
import { inputBase, inputError } from "./styles";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, style, ...rest },
  ref,
) {
  const merged: CSSProperties = {
    ...inputBase,
    ...(invalid ? inputError : {}),
    ...style,
  };
  return <input ref={ref} style={merged} {...rest} />;
});