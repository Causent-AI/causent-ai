import { Parser } from "htmlparser2";

import { normalizedSourceText } from "./types.ts";

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

const IGNORED_TAGS = new Set([
  "canvas",
  "embed",
  "iframe",
  "noscript",
  "object",
  "script",
  "style",
  "svg",
  "template",
]);

export type ExtractedHtml = { title: string | null; text: string };

export function extractStructuralHtmlText(html: string): ExtractedHtml {
  const textParts: string[] = [];
  const titleParts: string[] = [];
  const ignoredStack: string[] = [];
  let inHead = false;
  let inTitle = false;

  const addBoundary = () => {
    if (textParts.at(-1) !== "\n") textParts.push("\n");
  };

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (IGNORED_TAGS.has(name) || ignoredStack.length > 0) {
          ignoredStack.push(name);
          return;
        }
        if (name === "head") {
          inHead = true;
          return;
        }
        if (name === "title") {
          inTitle = true;
          return;
        }
        if (attributes.hidden !== undefined || attributes["aria-hidden"] === "true") {
          ignoredStack.push(name);
          return;
        }
        if (BLOCK_TAGS.has(name)) addBoundary();
      },
      ontext(value) {
        if (ignoredStack.length > 0) return;
        if (inTitle) {
          titleParts.push(value);
          return;
        }
        if (inHead) return;
        textParts.push(value);
      },
      onclosetag(name) {
        if (ignoredStack.length > 0) {
          const index = ignoredStack.lastIndexOf(name);
          if (index >= 0) ignoredStack.splice(index);
          return;
        }
        if (name === "title") {
          inTitle = false;
          return;
        }
        if (name === "head") {
          inHead = false;
          return;
        }
        if (BLOCK_TAGS.has(name)) addBoundary();
      },
    },
    { decodeEntities: true, lowerCaseAttributeNames: true, lowerCaseTags: true },
  );

  parser.end(html);
  const title = normalizedSourceText(titleParts.join(" "));
  return {
    title: title ? title.slice(0, 160) : null,
    text: normalizedSourceText(textParts.join("")),
  };
}
