"use client";

import { Extension, type JSONContent } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useRef, useState } from "react";

import { useDocumentEditor } from "@/components/decision-report/rich-text/DocumentEditorContext";
import type { PortableRichTextDocument } from "@/lib/decision-reports/schema";
import { validatePortableRichTextDocument } from "@/lib/decision-reports/schema";
import { portableDocumentFromTiptap } from "@/lib/decision-reports/tiptap-adapter";

function safeLinkHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

const BoundedPortableDocument = Extension.create({
  name: "boundedPortableDocument",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction(transaction) {
          if (!transaction.docChanged) return true;
          return validatePortableRichTextDocument(
            portableDocumentFromTiptap(transaction.doc.toJSON()),
          ).success;
        },
      }),
    ];
  },
});

function documentsMatch(
  editorDocument: JSONContent,
  portableDocument: PortableRichTextDocument,
): boolean {
  return JSON.stringify(portableDocumentFromTiptap(editorDocument)) ===
    JSON.stringify(portableDocument);
}

export function RichTextClaimEditor({
  claimId,
  label,
  document,
  placeholder,
  readOnly,
  invalid,
  onChange,
}: {
  claimId: string;
  label: string;
  document: PortableRichTextDocument;
  placeholder?: string;
  readOnly: boolean;
  invalid: boolean;
  onChange: (document: PortableRichTextDocument) => void;
}) {
  const { activate, deactivate } = useDocumentEditor();
  const onChangeRef = useRef(onChange);
  const [editorError, setEditorError] = useState<string | null>(null);
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        heading: { levels: [2, 3] },
        horizontalRule: false,
        link: {
          autolink: true,
          defaultProtocol: "https",
          linkOnPaste: true,
          openOnClick: false,
          protocols: ["http", "https"],
          HTMLAttributes: {
            rel: "noopener noreferrer nofollow",
            target: "_blank",
          },
          isAllowedUri: (url, { defaultValidate }) =>
            defaultValidate(url) && safeLinkHref(url) !== null,
        },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "Write here…" }),
      BoundedPortableDocument,
    ],
    [placeholder],
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor(
    {
      extensions,
      content: document,
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          id: `claim-${claimId}`,
          role: "textbox",
          "aria-label": label,
          "aria-multiline": "true",
          "aria-invalid": invalid ? "true" : "false",
          spellcheck: "true",
          autocapitalize: "sentences",
          class:
            "tiptap min-h-12 w-full px-1 py-0.5 text-[15px] leading-7 text-[var(--text)] outline-none",
        },
      },
      onFocus: ({ editor: focusedEditor }) => {
        activate({ editor: focusedEditor, claimId, label });
      },
      onUpdate: ({ editor: updatedEditor }) => {
        const next = portableDocumentFromTiptap(updatedEditor.getJSON());
        const validation = validatePortableRichTextDocument(next);
        if (!validation.success) {
          setEditorError("This edit is too large or contains unsupported formatting.");
          return;
        }
        setEditorError(null);
        onChangeRef.current(validation.data);
      },
    },
    [claimId],
  );

  useEffect(
    () => () => {
      if (editor) deactivate(editor);
    },
    [deactivate, editor],
  );

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute("aria-invalid", invalid ? "true" : "false");
    editor.view.dom.setAttribute("aria-label", label);
  }, [editor, invalid, label]);

  useEffect(() => {
    if (!editor || documentsMatch(editor.getJSON(), document)) return;
    editor.commands.setContent(document, { emitUpdate: false });
  }, [document, editor]);

  return (
    <div
      className={`rich-text-editor rounded-md border px-2 py-2 transition-colors ${
        invalid
          ? "border-amber-300 bg-amber-50/45"
          : "border-transparent bg-transparent focus-within:border-blue-200 focus-within:bg-white"
      } ${readOnly ? "cursor-default" : "cursor-text"}`}
      onClick={() => editor?.commands.focus()}
    >
      <EditorContent
        editor={editor}
        className="[&_.tiptap_a]:cursor-pointer [&_.tiptap_a]:font-medium [&_.tiptap_a]:text-blue-700 [&_.tiptap_a]:underline [&_.tiptap_a]:underline-offset-2 [&_.tiptap_blockquote]:my-2 [&_.tiptap_blockquote]:border-l-4 [&_.tiptap_blockquote]:border-slate-300 [&_.tiptap_blockquote]:pl-4 [&_.tiptap_blockquote]:italic [&_.tiptap_h2]:mb-1 [&_.tiptap_h2]:mt-3 [&_.tiptap_h2]:text-[20px] [&_.tiptap_h2]:font-semibold [&_.tiptap_h2]:leading-7 [&_.tiptap_h3]:mb-1 [&_.tiptap_h3]:mt-2 [&_.tiptap_h3]:text-[17px] [&_.tiptap_h3]:font-semibold [&_.tiptap_li]:my-0.5 [&_.tiptap_ol]:my-2 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-6 [&_.tiptap_p]:my-1 [&_.tiptap_ul]:my-2 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-6"
      />
      {editorError ? (
        <p className="mt-1 text-[10px] font-medium text-red-700" role="alert">
          {editorError}
        </p>
      ) : null}
    </div>
  );
}
