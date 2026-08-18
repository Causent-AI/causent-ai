import type { JSONContent } from "@tiptap/core";

import type {
  PortableRichTextBlockNode,
  PortableRichTextDocument,
  PortableRichTextInlineNode,
  PortableRichTextListItemNode,
  PortableRichTextMark,
} from "./schema.ts";

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

function portableMarks(
  marks: JSONContent["marks"],
): PortableRichTextMark[] | undefined {
  if (!marks?.length) return undefined;
  const portable: PortableRichTextMark[] = [];
  const seen = new Set<string>();

  for (const mark of marks) {
    if (["bold", "italic", "strike", "underline"].includes(mark.type)) {
      if (seen.has(mark.type)) continue;
      seen.add(mark.type);
      portable.push({
        type: mark.type as "bold" | "italic" | "strike" | "underline",
      });
      continue;
    }

    if (mark.type !== "link" || seen.has("link")) continue;
    const href = safeLinkHref(mark.attrs?.href);
    if (!href) continue;
    seen.add("link");
    portable.push({ type: "link", attrs: { href } });
  }

  return portable.length ? portable : undefined;
}

function portableInline(node: JSONContent): PortableRichTextInlineNode | null {
  if (node.type === "hardBreak") return { type: "hardBreak" };
  if (node.type !== "text" || typeof node.text !== "string" || node.text === "") {
    return null;
  }

  const marks = portableMarks(node.marks);
  return marks
    ? { type: "text", text: node.text, marks }
    : { type: "text", text: node.text };
}

function portableListItem(node: JSONContent): PortableRichTextListItemNode {
  const content = (node.content ?? [])
    .map(portableBlock)
    .filter((block): block is PortableRichTextBlockNode => block !== null);

  return {
    type: "listItem",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

function portableBlock(node: JSONContent): PortableRichTextBlockNode | null {
  if (node.type === "paragraph" || node.type === "heading") {
    const content = (node.content ?? [])
      .map(portableInline)
      .filter((inline): inline is PortableRichTextInlineNode => inline !== null);

    if (node.type === "heading") {
      // Causent deliberately supports only h2 and h3. Tiptap/clipboard h1 and
      // every unknown level are reduced to h2 instead of retaining library attrs.
      const level = node.attrs?.level === 3 ? 3 : 2;
      return content.length
        ? { type: "heading", attrs: { level }, content }
        : { type: "heading", attrs: { level } };
    }

    return content.length
      ? { type: "paragraph", content }
      : { type: "paragraph" };
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const content = (node.content ?? [])
      .filter((item) => item.type === "listItem")
      .map(portableListItem);

    if (!content.length) return { type: "paragraph" };
    return node.type === "bulletList"
      ? { type: "bulletList", content }
      : { type: "orderedList", content };
  }

  if (node.type === "blockquote") {
    const content = (node.content ?? [])
      .map(portableBlock)
      .filter((block): block is PortableRichTextBlockNode => block !== null);

    return content.length
      ? { type: "blockquote", content }
      : { type: "paragraph" };
  }

  return null;
}

/** Convert Tiptap JSON into Causent's smaller, stable, application-owned format. */
export function portableDocumentFromTiptap(
  document: JSONContent,
): PortableRichTextDocument {
  const content = (document.content ?? [])
    .map(portableBlock)
    .filter((block): block is PortableRichTextBlockNode => block !== null);

  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}
