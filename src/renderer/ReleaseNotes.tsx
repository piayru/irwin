import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

// Release bodies are remote content. Only passive document formatting is
// allowed: no scripts, styles, embeds, forms, navigation or network resources.
// Users can follow the original links through the GitHub Releases button.
export function ReleaseNotes({ content }: { content: string }) {
  const html = useMemo(() => {
    if (typeof DOMPurify.sanitize !== "function") return undefined;
    return DOMPurify.sanitize(marked.parse(content, { async: false }), {
      ALLOWED_TAGS: [
        "p",
        "br",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "strong",
        "b",
        "em",
        "i",
        "del",
        "s",
        "code",
        "pre",
        "blockquote",
        "hr",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "details",
        "summary",
        "div",
        "span",
        "kbd",
        "sup",
        "sub",
      ],
      ALLOWED_ATTR: ["colspan", "rowspan"],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    });
  }, [content]);
  return html === undefined ? (
    <pre className="release-notes-content">{content}</pre>
  ) : (
    <div
      className="release-notes-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
