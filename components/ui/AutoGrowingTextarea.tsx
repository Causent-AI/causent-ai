"use client";

import {
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type TextareaHTMLAttributes,
} from "react";

function fitTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "0px";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export function AutoGrowingTextarea({
  value,
  onChange,
  rows = 1,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    fitTextarea(textareaRef.current);
  }, [value]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const refit = () => fitTextarea(textarea);
    const disclosure = textarea.closest("details");

    disclosure?.addEventListener("toggle", refit);
    window.addEventListener("resize", refit);
    return () => {
      disclosure?.removeEventListener("toggle", refit);
      window.removeEventListener("resize", refit);
    };
  }, []);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    fitTextarea(event.currentTarget);
    onChange?.(event);
  }

  return (
    <textarea
      {...props}
      ref={textareaRef}
      value={value}
      rows={rows}
      className={`resize-none overflow-hidden ${className}`}
      onChange={handleChange}
    />
  );
}
