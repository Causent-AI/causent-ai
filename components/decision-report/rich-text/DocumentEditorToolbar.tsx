"use client";

import type { Editor } from "@tiptap/core";
import { type ReactNode, useEffect, useId, useState } from "react";

import { useDocumentEditor } from "@/components/decision-report/rich-text/DocumentEditorContext";

function ToolbarButton({
  label,
  pressed,
  disabled,
  className = "",
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border px-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35 md:min-h-9 md:min-w-9 ${
        pressed
          ? "border-blue-200 bg-blue-100 text-blue-900"
          : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-white"
      } ${className}`}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function safeLinkHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function run(editor: Editor | null, command: (editor: Editor) => boolean) {
  if (!editor || editor.isDestroyed) return;
  command(editor);
}

export function DocumentEditorToolbar({
  readOnly,
  editor: providedEditor,
  variant = "mobile",
}: {
  readOnly: boolean;
  editor?: Editor | null;
  variant?: "mobile" | "bubble";
}) {
  const { active } = useDocumentEditor();
  const editor = providedEditor === undefined
    ? active?.editor ?? null
    : providedEditor;
  const blockStyleId = useId();
  const linkInputId = useId();
  const [, setTransaction] = useState(0);
  const [showLinkEditor, setShowLinkEditor] = useState(false);
  const [linkEditor, setLinkEditor] = useState<Editor | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => setTransaction((version) => version + 1);
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const disabled =
    readOnly ||
    !editor ||
    editor.isDestroyed ||
    editor.isActive("reportActionTitle");
  const blockType = editor?.isActive("heading", { level: 2 })
    ? "heading-2"
    : editor?.isActive("heading", { level: 3 })
      ? "heading-3"
      : "paragraph";

  function openLinkEditor() {
    if (!editor) return;
    setLinkValue(String(editor.getAttributes("link").href ?? ""));
    setLinkEditor(editor);
    setLinkError(null);
    setShowLinkEditor(true);
  }

  function applyLink() {
    if (!editor) return;
    if (linkValue.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setShowLinkEditor(false);
      setLinkEditor(null);
      return;
    }
    const href = safeLinkHref(linkValue);
    if (!href) {
      setLinkError("Use a valid http or https link.");
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href })
      .run();
    setShowLinkEditor(false);
    setLinkEditor(null);
    setLinkError(null);
  }

  if (readOnly) return null;

  return (
    <div
      className={
        variant === "bubble"
          ? "scroll-slim max-w-[min(92vw,52rem)] overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/15"
          : "scroll-slim w-full overflow-x-auto"
      }
      role="toolbar"
      aria-orientation="horizontal"
      aria-label="Document formatting tools"
    >
      <div className="flex min-w-max flex-nowrap items-center gap-1">
        <label className="sr-only" htmlFor={blockStyleId}>
          Text style
        </label>
        <select
          id={blockStyleId}
          className="min-h-11 shrink-0 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-[var(--brand-blue)] disabled:opacity-45 md:min-h-9"
          value={blockType}
          disabled={disabled}
          aria-label="Text style"
          onChange={(event) => {
            const value = event.target.value;
            run(editor, (current) => {
              if (value === "heading-2") {
                return current.chain().focus().setHeading({ level: 2 }).run();
              }
              if (value === "heading-3") {
                return current.chain().focus().setHeading({ level: 3 }).run();
              }
              return current.chain().focus().setParagraph().run();
            });
          }}
        >
          <option value="paragraph">Paragraph</option>
          <option value="heading-2">Heading</option>
          <option value="heading-3">Subheading</option>
        </select>

        <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden />
        <ToolbarButton
          label="Bold (Command+B)"
          pressed={editor?.isActive("bold")}
          disabled={disabled}
          onClick={() => run(editor, (current) => current.chain().focus().toggleBold().run())}
        >
          <span className="text-[13px] font-black">B</span>
        </ToolbarButton>
        <ToolbarButton
          label="Italic (Command+I)"
          pressed={editor?.isActive("italic")}
          disabled={disabled}
          onClick={() => run(editor, (current) => current.chain().focus().toggleItalic().run())}
        >
          <span className="text-[13px] italic">I</span>
        </ToolbarButton>
        <ToolbarButton
          label="Underline (Command+U)"
          pressed={editor?.isActive("underline")}
          disabled={disabled}
          onClick={() => run(editor, (current) => current.chain().focus().toggleUnderline().run())}
        >
          <span className="text-[13px] underline">U</span>
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          pressed={editor?.isActive("strike")}
          disabled={disabled}
          onClick={() => run(editor, (current) => current.chain().focus().toggleStrike().run())}
        >
          <span className="text-[13px] line-through">S</span>
        </ToolbarButton>

        <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden />
        <ToolbarButton
          label="Bulleted list"
          pressed={editor?.isActive("bulletList")}
          disabled={disabled}
          onClick={() => run(editor, (current) => current.chain().focus().toggleBulletList().run())}
        >
          • List
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          pressed={editor?.isActive("orderedList")}
          disabled={disabled}
          onClick={() => run(editor, (current) => current.chain().focus().toggleOrderedList().run())}
        >
          1. List
        </ToolbarButton>
        <ToolbarButton
          label="Block quote"
          pressed={editor?.isActive("blockquote")}
          disabled={disabled}
          onClick={() => run(editor, (current) => current.chain().focus().toggleBlockquote().run())}
        >
          “ Quote
        </ToolbarButton>
        <ToolbarButton
          label="Add or edit link"
          pressed={editor?.isActive("link")}
          disabled={disabled}
          onClick={openLinkEditor}
        >
          Link
        </ToolbarButton>

        <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden />
        <ToolbarButton
          label="Clear formatting"
          disabled={disabled}
          onClick={() =>
            run(editor, (current) =>
              current.chain().focus().unsetAllMarks().clearNodes().run(),
            )
          }
        >
          Clear
        </ToolbarButton>
        <ToolbarButton
          label="Undo (Command+Z)"
          disabled={disabled || !editor?.can().chain().focus().undo().run()}
          onClick={() => run(editor, (current) => current.chain().focus().undo().run())}
        >
          ↶
        </ToolbarButton>
        <ToolbarButton
          label="Redo (Command+Shift+Z)"
          disabled={disabled || !editor?.can().chain().focus().redo().run()}
          onClick={() => run(editor, (current) => current.chain().focus().redo().run())}
        >
          ↷
        </ToolbarButton>
      </div>

      {showLinkEditor && linkEditor === editor ? (
        <div className="mt-2 flex min-w-[min(88vw,32rem)] flex-wrap items-start gap-2 rounded-lg border border-blue-200 bg-white p-2 shadow-sm">
          <div className="min-w-[220px] flex-1">
            <label
              className="sr-only"
              htmlFor={linkInputId}
            >
              Link address
            </label>
            <input
              id={linkInputId}
              className="min-h-11 w-full rounded-md border border-slate-200 px-2 text-[12px] outline-none focus:border-[var(--brand-blue)] md:min-h-9"
              value={linkValue}
              placeholder="https://example.com"
              autoFocus
              aria-invalid={Boolean(linkError)}
              onChange={(event) => {
                setLinkValue(event.target.value);
                setLinkError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyLink();
                }
                if (event.key === "Escape") {
                  setShowLinkEditor(false);
                  setLinkEditor(null);
                  editor?.commands.focus();
                }
              }}
            />
            {linkError ? (
              <p className="mt-1 text-[10px] font-medium text-red-700" role="alert">
                {linkError}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="min-h-11 rounded-md bg-[var(--text)] px-3 text-[11px] font-semibold text-white md:min-h-9"
            onClick={applyLink}
          >
            Apply link
          </button>
          <button
            type="button"
            className="min-h-11 rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 md:min-h-9"
            onClick={() => {
              setShowLinkEditor(false);
              setLinkEditor(null);
              editor?.commands.focus();
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
