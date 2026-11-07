import sanitizeHtml from "sanitize-html";

const ALERT_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li",
    "h1", "h2", "h3", "h4", "span", "div", "table", "thead", "tbody",
    "tr", "td", "th", "img", "hr", "blockquote",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height", "style"],
    "*": ["style"],
  },
  allowedSchemes: ["http", "https", "mailto"],
};

export function sanitizeAlertBody(body: string): string {
  return sanitizeHtml(body, ALERT_HTML_OPTIONS);
}

export function stripToPlainText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim();
}