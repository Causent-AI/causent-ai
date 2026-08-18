import assert from "node:assert/strict";
import { test } from "node:test";

import type { JSONContent } from "@tiptap/core";

import { validatePortableRichTextDocument } from "./schema.ts";
import { portableDocumentFromTiptap } from "./tiptap-adapter.ts";

test("supported Tiptap JSON round-trips into the portable document", () => {
  const source: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Decision", marks: [{ type: "bold" }] }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ship ", marks: [{ type: "italic" }] },
          {
            type: "text",
            text: "now",
            marks: [
              { type: "underline" },
              { type: "link", attrs: { href: "https://example.com/plan" } },
            ],
          },
          { type: "hardBreak" },
          { type: "text", text: "with care", marks: [{ type: "strike" }] },
        ],
      },
      {
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Evidence" }] }],
      },
    ],
  };

  const portable = portableDocumentFromTiptap(source);

  assert.deepEqual(portable, {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Decision", marks: [{ type: "bold" }] }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ship ", marks: [{ type: "italic" }] },
          {
            type: "text",
            text: "now",
            marks: [
              { type: "underline" },
              { type: "link", attrs: { href: "https://example.com/plan" } },
            ],
          },
          { type: "hardBreak" },
          { type: "text", text: "with care", marks: [{ type: "strike" }] },
        ],
      },
      {
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Evidence" }] }],
      },
    ],
  });
  assert.equal(validatePortableRichTextDocument(portable).success, true);
});

test("Docs-like attributes are stripped and h1 is normalized to h2", () => {
  const portable = portableDocumentFromTiptap({
    type: "doc",
    attrs: { class: "docs-root", title: "forged root" },
    content: [
      {
        type: "heading",
        attrs: { level: 1, id: "docs-heading", class: "title", dir: "ltr" },
        content: [{
          type: "text",
          text: "Imported plan",
          marks: [
            { type: "bold", attrs: { class: "docs-bold", style: "color:red" } },
            {
              type: "link",
              attrs: {
                href: "https://example.com/reference",
                target: "_self",
                rel: "opener",
                class: "docs-link",
                title: "untrusted title",
              },
            },
          ],
        }],
      },
      {
        type: "orderedList",
        attrs: { start: 9, class: "docs-list", tight: true },
        content: [{
          type: "listItem",
          attrs: { class: "docs-item", value: 9 },
          content: [{
            type: "paragraph",
            attrs: { class: "docs-paragraph", textAlign: "center" },
            content: [{ type: "text", text: "First", marks: [{ type: "italic", attrs: { title: "ignored" } }] }],
          }],
        }],
      },
    ],
  });

  assert.deepEqual(portable, {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{
          type: "text",
          text: "Imported plan",
          marks: [
            { type: "bold" },
            { type: "link", attrs: { href: "https://example.com/reference" } },
          ],
        }],
      },
      {
        type: "orderedList",
        content: [{
          type: "listItem",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "First", marks: [{ type: "italic" }] }],
          }],
        }],
      },
    ],
  });
});

test("unsafe links, forged link values, unsupported marks, and unsupported nodes are removed", () => {
  const portable = portableDocumentFromTiptap({
    type: "doc",
    content: [
      { type: "image", attrs: { src: "data:image/png;base64,forged" } },
      { type: "codeBlock", content: [{ type: "text", text: "unsupported" }] },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "JavaScript",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
          { type: "text", text: " and " },
          {
            type: "text",
            text: "data",
            marks: [
              { type: "bold" },
              { type: "link", attrs: { href: "data:text/html,bad" } },
            ],
          },
          { type: "mention", attrs: { id: "forged" } },
          {
            type: "text",
            text: " forged",
            marks: [
              { type: "link", attrs: { href: { protocol: "https", value: "bad" } } },
              { type: "textStyle", attrs: { color: "red" } },
              { type: "comment", attrs: { userId: "attacker" } },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(portable, {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "JavaScript" },
        { type: "text", text: " and " },
        { type: "text", text: "data", marks: [{ type: "bold" }] },
        { type: "text", text: " forged" },
      ],
    }],
  });
  assert.equal(validatePortableRichTextDocument(portable).success, true);

  assert.deepEqual(
    portableDocumentFromTiptap({
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://example.com/image.png" } },
        { type: "horizontalRule" },
      ],
    }),
    { type: "doc", content: [{ type: "paragraph" }] },
  );
});

test("list structure is retained while invalid children and list attributes are discarded", () => {
  const portable = portableDocumentFromTiptap({
    type: "doc",
    content: [
      {
        type: "bulletList",
        attrs: { class: "imported" },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
              {
                type: "orderedList",
                attrs: { start: 4 },
                content: [{
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Nested" }] }],
                }],
              },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "Not a list item" }] },
          { type: "listItem", attrs: { value: 2 }, content: [{ type: "image" }] },
        ],
      },
      { type: "orderedList", attrs: { start: 99 }, content: [] },
    ],
  });

  assert.deepEqual(portable, {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
              {
                type: "orderedList",
                content: [{
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Nested" }] }],
                }],
              },
            ],
          },
          { type: "listItem", content: [{ type: "paragraph" }] },
        ],
      },
      { type: "paragraph" },
    ],
  });
  assert.equal(validatePortableRichTextDocument(portable).success, true);
});
