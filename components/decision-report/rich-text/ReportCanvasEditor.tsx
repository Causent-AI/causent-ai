"use client";

import { Extension, Node, type Editor, type JSONContent } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin } from "@tiptap/pm/state";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useDocumentEditor } from "@/components/decision-report/rich-text/DocumentEditorContext";
import { DocumentEditorToolbar } from "@/components/decision-report/rich-text/DocumentEditorToolbar";
import type { PortableRichTextDocument } from "@/lib/decision-reports/schema";
import { validatePortableRichTextDocument } from "@/lib/decision-reports/schema";
import { portableDocumentFromTiptap } from "@/lib/decision-reports/tiptap-adapter";

export type ReportCanvasSection = {
  claimId: string;
  label: string;
  document: PortableRichTextDocument;
  invalid?: boolean;
  editableTitle?: {
    titleId: string;
    value: string;
    label: string;
    invalid?: boolean;
  };
  after?: {
    slotId: string;
    content: ReactNode;
  };
};

export type ReportCanvasDocumentChange = {
  claimId: string;
  document: PortableRichTextDocument;
};

export type ReportCanvasTitleChange = {
  titleId: string;
  value: string;
};

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

const ReportCanvasDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "(reportSection | reportSlot)+",
});

const ReportActionTitleNode = Node.create({
  name: "reportActionTitle",
  group: "block",
  content: "text*",
  marks: "",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      titleId: { default: null },
      label: { default: "Action title" },
      invalid: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: "h3[data-report-action-title]" }];
  },
  renderHTML({ node }) {
    const titleId = String(node.attrs.titleId ?? "");
    const invalid = node.attrs.invalid === true;
    return [
      "h3",
      {
        id: `action-title-${titleId}`,
        "data-report-action-title": titleId,
        "data-placeholder": "Action title",
        "aria-label": String(node.attrs.label ?? "Action title"),
        "aria-invalid": invalid ? "true" : "false",
        class: `report-canvas-action-title${invalid ? " report-canvas-action-title-invalid" : ""}`,
      },
      0,
    ];
  },
});

const ReportSectionNode = Node.create({
  name: "reportSection",
  content: "(reportActionTitle? (paragraph | heading | bulletList | orderedList | blockquote)+)",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      claimId: { default: null },
      label: { default: "Section" },
      invalid: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: "section[data-report-section]" }];
  },
  renderHTML({ node }) {
    const claimId = String(node.attrs.claimId ?? "");
    const label = String(node.attrs.label ?? "Section");
    const invalid = node.attrs.invalid === true;
    return [
      "section",
      {
        id: `claim-${claimId}`,
        "data-report-section": claimId,
        "data-invalid": invalid ? "true" : "false",
        class: `report-canvas-section${invalid ? " report-canvas-section-invalid" : ""}`,
      },
      [
        "h2",
        {
          class: "report-canvas-section-title",
          contenteditable: "false",
        },
        label,
      ],
      ["div", { class: "report-canvas-section-body" }, 0],
    ];
  },
});

const ReportCanvasSlots = createContext<Record<string, ReactNode>>({});

function ReportCanvasSlotView({ node }: NodeViewProps) {
  const slots = useContext(ReportCanvasSlots);
  const slotId = String(node.attrs.slotId ?? "");
  return (
    <NodeViewWrapper
      as="div"
      data-report-slot={slotId}
      className="report-canvas-slot"
      contentEditable={false}
    >
      {slots[slotId] ?? null}
    </NodeViewWrapper>
  );
}

const ReportSlotNode = Node.create({
  name: "reportSlot",
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { slotId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-report-slot]" }];
  },
  renderHTML({ node }) {
    return ["div", { "data-report-slot": String(node.attrs.slotId ?? "") }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ReportCanvasSlotView);
  },
});

function canvasJson(sections: ReportCanvasSection[]): JSONContent {
  return {
    type: "doc",
    content: sections.flatMap((section) => [
      {
        type: "reportSection",
        attrs: {
          claimId: section.claimId,
          label: section.label,
          invalid: section.invalid === true,
        },
        content: [
          ...(section.editableTitle
            ? [{
                type: "reportActionTitle",
                attrs: {
                  titleId: section.editableTitle.titleId,
                  label: section.editableTitle.label,
                  invalid: section.editableTitle.invalid === true,
                },
                ...(section.editableTitle.value
                  ? { content: [{ type: "text", text: section.editableTitle.value }] }
                  : {}),
              }]
            : []),
          ...section.document.content,
        ],
      },
      ...(section.after
        ? [{
            type: "reportSlot",
            attrs: { slotId: section.after.slotId },
          }]
        : []),
    ]),
  };
}

type ReadCanvasState = {
  documents: ReportCanvasDocumentChange[];
  titles: ReportCanvasTitleChange[];
};

function readCanvasState(
  value: JSONContent,
): ReadCanvasState | null {
  if (value.type !== "doc" || !Array.isArray(value.content)) return null;
  const changes: ReportCanvasDocumentChange[] = [];
  const titles: ReportCanvasTitleChange[] = [];
  for (const section of value.content) {
    if (section.type === "reportSlot") continue;
    if (
      section.type !== "reportSection" ||
      typeof section.attrs?.claimId !== "string" ||
      !Array.isArray(section.content)
    ) {
      return null;
    }
    const titleNodes = section.content.filter(
      (node) => node.type === "reportActionTitle",
    );
    if (titleNodes.length > 1) return null;
    const titleNode = titleNodes[0];
    if (titleNode) {
      if (
        section.content[0] !== titleNode ||
        typeof titleNode.attrs?.titleId !== "string" ||
        (titleNode.content ?? []).some(
          (node) => node.type !== "text" || typeof node.text !== "string",
        )
      ) {
        return null;
      }
      titles.push({
        titleId: titleNode.attrs.titleId,
        value: (titleNode.content ?? []).map((node) => node.text ?? "").join(""),
      });
    }
    const document = portableDocumentFromTiptap({
      type: "doc",
      content: section.content.filter(
        (node) => node.type !== "reportActionTitle",
      ),
    });
    const validation = validatePortableRichTextDocument(document);
    if (!validation.success) return null;
    changes.push({
      claimId: section.attrs.claimId,
      document: validation.data,
    });
  }
  return { documents: changes, titles };
}

function readCanvasDocuments(
  value: JSONContent,
): ReportCanvasDocumentChange[] | null {
  return readCanvasState(value)?.documents ?? null;
}

function hasExpectedStructure(
  value: JSONContent,
  expected: Array<
    | {
        type: "reportSection";
        claimId: string;
        label: string;
        editableTitleId?: string;
      }
    | { type: "reportSlot"; slotId: string }
  >,
): boolean {
  if (value.type !== "doc" || value.content?.length !== expected.length) {
    return false;
  }
  return expected.every((section, index) => {
    const node = value.content?.[index];
    if (section.type === "reportSlot") {
      return node?.type === "reportSlot" &&
        node.attrs?.slotId === section.slotId;
    }
    const titleNodes = node?.content?.filter(
      (child) => child.type === "reportActionTitle",
    ) ?? [];
    const expectedTitle = section.editableTitleId;
    const titleValid = expectedTitle
      ? titleNodes.length === 1 &&
        node?.content?.[0] === titleNodes[0] &&
        titleNodes[0].attrs?.titleId === expectedTitle
      : titleNodes.length === 0;
    return node?.type === "reportSection" &&
      node.attrs?.claimId === section.claimId &&
      node.attrs?.label === section.label &&
      titleValid &&
      Array.isArray(node.content) &&
      readCanvasDocuments({ type: "doc", content: [node] }) !== null;
  });
}

function hasSameCanvasShape(
  current: JSONContent,
  next: JSONContent,
): boolean {
  if (
    current.type !== "doc" ||
    next.type !== "doc" ||
    current.content?.length !== next.content?.length
  ) {
    return false;
  }
  return (next.content ?? []).every((nextNode, index) => {
    const currentNode = current.content?.[index];
    if (nextNode.type === "reportSlot") {
      return currentNode?.type === "reportSlot" &&
        currentNode.attrs?.slotId === nextNode.attrs?.slotId;
    }
    return nextNode.type === "reportSection" &&
      currentNode?.type === "reportSection";
  });
}

function hasSameCanvasDocumentBodies(
  current: JSONContent,
  next: JSONContent,
): boolean {
  const currentDocuments = readCanvasDocuments(current);
  const nextDocuments = readCanvasDocuments(next);
  return currentDocuments !== null &&
    nextDocuments !== null &&
    JSON.stringify(currentDocuments.map((entry) => entry.document)) ===
      JSON.stringify(nextDocuments.map((entry) => entry.document));
}

function hasSameCanvasEditableTitles(
  current: JSONContent,
  next: JSONContent,
): boolean {
  const currentState = readCanvasState(current);
  const nextState = readCanvasState(next);
  return currentState !== null &&
    nextState !== null &&
    JSON.stringify(currentState.titles) === JSON.stringify(nextState.titles);
}

function syncSectionAttributes(editor: Editor, next: JSONContent): void {
  const expectedNodes = next.content ?? [];
  const transaction = editor.state.tr;
  editor.state.doc.forEach((node, position, index) => {
    if (node.type.name !== "reportSection") return;
    const expectedNode = expectedNodes[index];
    if (expectedNode?.type !== "reportSection") return;
    const expected = {
      claimId: String(expectedNode.attrs?.claimId ?? ""),
      label: String(expectedNode.attrs?.label ?? "Section"),
      invalid: expectedNode.attrs?.invalid === true,
    };
    const sectionAttributesMatch =
      node.attrs.claimId === expected.claimId &&
      node.attrs.label === expected.label &&
      node.attrs.invalid === expected.invalid;
    if (!sectionAttributesMatch) {
      transaction.setNodeMarkup(position, undefined, {
        ...node.attrs,
        claimId: expected.claimId,
        label: expected.label,
        invalid: expected.invalid,
      });
    }

    const currentTitle = node.firstChild;
    const expectedTitle = expectedNode.content?.[0];
    if (
      currentTitle?.type.name === "reportActionTitle" &&
      expectedTitle?.type === "reportActionTitle"
    ) {
      const titleAttrs = {
        titleId: String(expectedTitle.attrs?.titleId ?? ""),
        label: String(expectedTitle.attrs?.label ?? "Action title"),
        invalid: expectedTitle.attrs?.invalid === true,
      };
      if (
        currentTitle.attrs.titleId !== titleAttrs.titleId ||
        currentTitle.attrs.label !== titleAttrs.label ||
        currentTitle.attrs.invalid !== titleAttrs.invalid
      ) {
        transaction.setNodeMarkup(position + 1, undefined, {
          ...currentTitle.attrs,
          ...titleAttrs,
        });
      }
    }
  });
  if (!transaction.docChanged) return;
  transaction.setMeta("addToHistory", false);
  transaction.setMeta("preventUpdate", true);
  editor.view.dispatch(transaction);
}

function expectedStructure(sections: ReportCanvasSection[]) {
  return sections.flatMap((section) => [
    {
      type: "reportSection" as const,
      claimId: section.claimId,
      label: section.label,
      ...(section.editableTitle
        ? { editableTitleId: section.editableTitle.titleId }
        : {}),
    },
    ...(section.after
      ? [{ type: "reportSlot" as const, slotId: section.after.slotId }]
      : []),
  ]);
}

function createLatestCanvasState(sections: ReportCanvasSection[]) {
  let expected = expectedStructure(sections);
  let documents = new Map(
    sections.map((section) => [section.claimId, section.document]),
  );
  let titles = new Map(
    sections.flatMap((section) =>
      section.editableTitle
        ? [[section.editableTitle.titleId, section.editableTitle.value] as const]
        : [],
    ),
  );
  return {
    update(nextSections: ReportCanvasSection[]) {
      expected = expectedStructure(nextSections);
      documents = new Map(
        nextSections.map((section) => [section.claimId, section.document]),
      );
      titles = new Map(
        nextSections.flatMap((section) =>
          section.editableTitle
            ? [[section.editableTitle.titleId, section.editableTitle.value] as const]
            : [],
        ),
      );
    },
    expected() {
      return expected;
    },
    document(claimId: string) {
      return documents.get(claimId);
    },
    title(titleId: string) {
      return titles.get(titleId);
    },
  };
}

function activeSection(editor: Editor): { claimId: string; label: string } | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "reportSection") continue;
    return {
      claimId: String(node.attrs.claimId ?? ""),
      label: String(node.attrs.label ?? "Section"),
    };
  }
  return null;
}

export function ReportCanvasEditor({
  canvasId,
  label,
  sections,
  readOnly,
  onChange,
  onTitleChange,
}: {
  canvasId: string;
  label: string;
  sections: ReportCanvasSection[];
  readOnly: boolean;
  onChange: (changes: ReportCanvasDocumentChange[]) => void;
  onTitleChange?: (changes: ReportCanvasTitleChange[]) => void;
}) {
  const { activate, deactivate } = useDocumentEditor();
  const onChangeRef = useRef(onChange);
  const onTitleChangeRef = useRef(onTitleChange);
  const [latest] = useState(() => createLatestCanvasState(sections));
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    latest.update(sections);
  }, [latest, sections]);

  const structureGuard = useMemo(
    () =>
      Extension.create({
        name: `reportCanvasGuard-${canvasId}`,
        addProseMirrorPlugins() {
          return [
            new Plugin({
              filterTransaction(transaction) {
                if (!transaction.docChanged) return true;
                return hasExpectedStructure(
                  transaction.doc.toJSON(),
                  latest.expected(),
                );
              },
            }),
          ];
        },
      }),
    [canvasId, latest],
  );

  const extensions = useMemo(
    () => [
      ReportCanvasDocument,
      ReportActionTitleNode,
      ReportSectionNode,
      ReportSlotNode,
      StarterKit.configure({
        document: false,
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
      Placeholder.configure({
        placeholder: "Write here…",
        includeChildren: true,
        showOnlyCurrent: false,
      }),
      structureGuard,
    ],
    [structureGuard],
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  const editor = useEditor(
    {
      extensions,
      content: canvasJson(sections),
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          id: canvasId,
          role: "textbox",
          "aria-label": label,
          "aria-multiline": "true",
          spellcheck: "true",
          autocapitalize: "sentences",
          class:
            "report-canvas tiptap min-h-32 w-full text-[15px] leading-7 text-[var(--text)] outline-none",
        },
      },
      onFocus: ({ editor: focusedEditor }) => {
        const section = activeSection(focusedEditor);
        activate({
          editor: focusedEditor,
          claimId: section?.claimId ?? canvasId,
          label: section?.label ?? label,
        });
      },
      onSelectionUpdate: ({ editor: currentEditor }) => {
        if (!currentEditor.isFocused) return;
        const section = activeSection(currentEditor);
        if (!section) return;
        activate({ editor: currentEditor, ...section });
      },
      onUpdate: ({ editor: updatedEditor }) => {
        const next = readCanvasState(updatedEditor.getJSON());
        if (!next) {
          setEditorError("This edit is too large or contains unsupported formatting.");
          return;
        }
        const changed = next.documents.filter((entry) => {
          const current = latest.document(entry.claimId);
          return !current || JSON.stringify(current) !== JSON.stringify(entry.document);
        });
        setEditorError(null);
        if (changed.length > 0) onChangeRef.current(changed);
        const changedTitles = next.titles.filter(
          (entry) => latest.title(entry.titleId) !== entry.value,
        );
        if (changedTitles.length > 0) {
          onTitleChangeRef.current?.(changedTitles);
        }
      },
    },
    [canvasId],
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

  const nextFingerprint = JSON.stringify(canvasJson(sections));
  const slots = Object.fromEntries(
    sections.flatMap((section) =>
      section.after
        ? [[section.after.slotId, section.after.content] as const]
        : [],
    ),
  );
  const nextFingerprintRef = useRef(nextFingerprint);
  useEffect(() => {
    nextFingerprintRef.current = nextFingerprint;
  }, [nextFingerprint]);
  useEffect(() => {
    if (!editor) return;
    const nextContent = JSON.parse(nextFingerprint) as JSONContent;
    let cancelled = false;

    // Tiptap's React node views synchronously flush while applying content.
    // Run controlled synchronization after React finishes this effect so those
    // node-view updates do not execute inside a lifecycle method.
    queueMicrotask(() => {
      if (
        cancelled ||
        editor.isDestroyed ||
        nextFingerprintRef.current !== nextFingerprint
      ) {
        return;
      }
      const currentContent = editor.getJSON();
      if (
        !hasSameCanvasShape(currentContent, nextContent) ||
        !hasSameCanvasDocumentBodies(currentContent, nextContent) ||
        !hasSameCanvasEditableTitles(currentContent, nextContent)
      ) {
        editor
          .chain()
          .setMeta("addToHistory", false)
          .setContent(nextContent, { emitUpdate: false })
          .run();
        return;
      }
      syncSectionAttributes(editor, nextContent);
    });

    return () => {
      cancelled = true;
    };
  }, [editor, nextFingerprint]);

  return (
    <div
      className={`report-canvas-editor overflow-hidden rounded-xl border bg-white shadow-sm shadow-slate-100 transition-shadow focus-within:border-blue-300 focus-within:shadow-md focus-within:shadow-blue-100/50 ${
        sections.some((section) => section.invalid)
          ? "border-amber-300"
          : "border-[var(--border)]"
      }`}
    >
      <ReportCanvasSlots.Provider value={slots}>
        {!readOnly && editor ? (
          <BubbleMenu
            editor={editor}
            pluginKey={`report-selection-toolbar-${canvasId}`}
            appendTo={() => document.body}
            options={{ placement: "top", strategy: "fixed", offset: 8 }}
            shouldShow={({ editor: currentEditor, from, to }) =>
              currentEditor.isFocused &&
              from !== to &&
              !currentEditor.isActive("reportActionTitle")
            }
            className="hidden max-w-[calc(100vw-2rem)] md:block"
          >
            <DocumentEditorToolbar
              editor={editor}
              readOnly={readOnly}
              variant="bubble"
            />
          </BubbleMenu>
        ) : null}
        <EditorContent
          editor={editor}
          className="[&_.report-canvas-action-title]:mb-2 [&_.report-canvas-action-title]:text-[18px] [&_.report-canvas-action-title]:font-semibold [&_.report-canvas-action-title]:leading-7 [&_.report-canvas-action-title]:text-[var(--text)] [&_.report-canvas-action-title.is-empty]:before:pointer-events-none [&_.report-canvas-action-title.is-empty]:before:text-slate-400 [&_.report-canvas-action-title.is-empty]:before:content-[attr(data-placeholder)] [&_.report-canvas-action-title-invalid]:rounded-md [&_.report-canvas-action-title-invalid]:bg-amber-50 [&_.report-canvas-action-title-invalid]:outline [&_.report-canvas-action-title-invalid]:outline-1 [&_.report-canvas-action-title-invalid]:outline-amber-400 [&_.report-canvas-section]:border-t [&_.report-canvas-section]:border-[var(--border)] [&_.report-canvas-section]:px-5 [&_.report-canvas-section]:py-5 [&_.report-canvas-section:first-child]:border-t-0 [&_.report-canvas-section-invalid]:bg-amber-50/45 [&_.report-canvas-section-title]:mb-2 [&_.report-canvas-section-title]:text-[11px] [&_.report-canvas-section-title]:font-semibold [&_.report-canvas-section-title]:uppercase [&_.report-canvas-section-title]:tracking-[0.12em] [&_.report-canvas-section-title]:text-[var(--text-subtle)] [&_.report-canvas-slot]:border-t [&_.report-canvas-slot]:border-[var(--border)] [&_.report-canvas-section-title]:text-[var(--text-subtle)] [&_.tiptap_a]:cursor-pointer [&_.tiptap_a]:font-medium [&_.tiptap_a]:text-blue-700 [&_.tiptap_a]:underline [&_.tiptap_a]:underline-offset-2 [&_.tiptap_blockquote]:my-2 [&_.tiptap_blockquote]:border-l-4 [&_.tiptap_blockquote]:border-slate-300 [&_.tiptap_blockquote]:pl-4 [&_.tiptap_blockquote]:italic [&_.tiptap_h2]:mb-1 [&_.tiptap_h2]:mt-3 [&_.tiptap_h2]:text-[20px] [&_.tiptap_h2]:font-semibold [&_.tiptap_h2]:leading-7 [&_.tiptap_h3]:mb-1 [&_.tiptap_h3]:mt-2 [&_.tiptap_h3]:text-[17px] [&_.tiptap_h3]:font-semibold [&_.tiptap_li]:my-0.5 [&_.tiptap_ol]:my-2 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-6 [&_.tiptap_p]:my-1 [&_.tiptap_ul]:my-2 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-6"
        />
      </ReportCanvasSlots.Provider>
      {editorError ? (
        <p className="border-t border-red-200 bg-red-50 px-4 py-2 text-[10px] font-medium text-red-700" role="alert">
          {editorError}
        </p>
      ) : null}
    </div>
  );
}
