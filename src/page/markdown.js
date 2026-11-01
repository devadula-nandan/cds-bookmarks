// Bob's answers as HTML: GitHub-flavoured Markdown parsed by marked, sanitized by DOMPurify, with code coloured
// by Prism and diffs tinted; and the to-dos in a checklist answer.

import { esc } from "../core.js";
import { Marked, Renderer } from "../vendor/marked.esm.js";
import DOMPurify from "../vendor/purify.es.js";

// ---------- syntax highlighting: Prism (src/vendor/prism.js, loaded by index.html) ----------
// Prism knows the usual short names (js, ts, sh, py, yml, html); these are the others Bob uses.
const LANG = { mjs: "js", cjs: "js", zsh: "bash", htm: "html", vue: "html" };
const grammarOf = (name) => {
  const l = String(name || "").toLowerCase();
  return globalThis.Prism?.languages[LANG[l] || l];
};

/** Code as HTML: coloured when Prism knows the language, otherwise just escaped. */
function highlight(code, lang) {
  const grammar = grammarOf(lang);
  if (!grammar) return esc(code);
  return (grammar.tag && attrLines(code, grammar, lang)) || Prism.highlight(code, grammar, lang);
}

const ATTR = /^\s*[\w:.-]+=["'{]/;
const COMMENT = /^\s*(\/\/|\/?\*|\{\s*\/\*)/;

/**
 * JSX or HTML attributes quoted without their tag (`aria-controls={open}`, as Bob quotes the lines a bug is on), coloured
 * as the attributes they are: each run of them is tokenized inside a stand-in tag, which is then dropped. Comment and
 * blank lines between runs are coloured on their own. Null when the code isn't such a fragment.
 */
function attrLines(code, grammar, lang) {
  const lines = code.split("\n");
  if (!lines.some((l) => ATTR.test(l)) || lines.some((l) => /^\s*</.test(l))) return null;
  const runs = [];
  for (const line of lines) {
    const loose = !line.trim() || COMMENT.test(line);
    if (runs.at(-1)?.loose === loose) runs.at(-1).lines.push(line);
    else runs.push({ loose, lines: [line] });
  }
  return runs
    .map(({ loose, lines }) => {
      const text = lines.join("\n");
      if (loose) return Prism.highlight(text, grammar, lang);
      const closed = /\/?>\s*$/.test(text);
      const tokens = Prism.tokenize(`<_ ${text}${closed ? "" : ">"}`, grammar);
      // Without the stand-in "<_", the space after it and, when it was added, the closing ">".
      const parts = tokens.length === 1 && tokens[0].type === "tag" ? tokens[0].content.slice(1) : [];
      if (typeof parts[0] !== "string") return Prism.highlight(text, grammar, lang);
      parts[0] = parts[0].slice(1);
      if (!closed) parts.pop();
      return Prism.Token.stringify(Prism.util.encode(parts), lang);
    })
    .join("\n");
}

/**
 * A fenced block with its language and a Copy button. Diffs tint added, removed and hunk lines and highlight the code in them,
 * a line at a time. `before` is the language of the answer's previous code block.
 */
function codeBlock(lang, body, before) {
  const diff = /^(diff|patch)$/i.test(lang) || body.some((l) => /^@@ /.test(l));
  // A diff's code language: the fence's (```tsx with a diff in it), the file's extension, or, for a diff with
  // no file header, the language of the code block before it (usually the code the diff changes).
  const file = body.map((l) => l.match(/^(?:\+\+\+|---) (?:[ab]\/)?\S+\.(\w+)/)?.[1]).find(Boolean);
  const code = diff && /^(diff|patch)?$/i.test(lang) ? file || before : lang;
  const html = diff
    ? body
        .map((l) => {
          const kind = /^(\+\+\+|---) /.test(l) ? "file" : /^@@/.test(l) ? "hunk" : /^\+/.test(l) ? "add" : /^-/.test(l) ? "del" : "";
          if (kind === "file" || kind === "hunk") return `<span class="diff-${kind}">${esc(l)}</span>`;
          const mark = /^[+\- ]/.test(l) ? l[0] : "";
          const rest = highlight(l.slice(mark.length), code);
          return kind ? `<span class="diff-${kind}"><span class="diff-mark">${mark}</span>${rest}</span>` : esc(mark) + rest;
        })
        .join("\n")
    : highlight(body.join("\n"), lang);
  return `<div class="code"><div class="code__bar"><span>${esc(lang || "code")}</span><button class="code__copy" type="button" data-action="copy-code">Copy</button></div><pre><code>${html}</code></pre></div>`;
}

// ---------- Markdown: marked, with the dashboard's own code blocks, links, task lists, headings and tables ----------

/** The language of the answer's last code block so far, for a diff with no file header. */
let lastLang = "";
/** Where the answer's links to files in the repo go (markdown()'s `files` option). */
let files = null;

const md = new Marked({
  gfm: true,
  // A line break in an answer is a line break, as on GitHub comments.
  breaks: true,
  renderer: {
    code({ text, lang }) {
      lang = (lang || "").split(/\s/)[0];
      const html = codeBlock(lang, text.split("\n"), lastLang);
      if (grammarOf(lang)) lastLang = lang;
      return html;
    },
    // Bob's answers are text: HTML in them is shown, not run.
    html: ({ text }) => esc(text),
    // h1 and h2 sit under the sheet's own title.
    heading({ tokens, depth }) {
      const tag = depth <= 2 ? "h3" : "h4";
      return `<${tag}>${this.parser.parseInline(tokens)}</${tag}>`;
    },
    // Web links open in a new tab, a bare GitHub URL without its "https://github.com/". A link to a file path in
    // the repo (Bob citing code, "path:42" or "path#L42") goes where the `files` option says, such as the PR's
    // diff or VS Code; without one it's the label, with the path on hover.
    link({ href, text, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (/^https?:\/\//i.test(href)) {
        const shown = text === href ? esc(href.replace(/^https:\/\/(www\.)?github\.com\//, "")) : label;
        return `<a href="${esc(href)}" target="_blank" rel="noopener">${shown}</a>`;
      }
      const [, path = href, line = ""] = href.match(/^([^#]+?)(?:(?::|#L)(\d+)\S*)?$/) || [];
      const file = decodeURI(path);
      const where = `${file}${line ? `:${line}` : ""}`;
      const to = files?.(file, line);
      if (!to) return `<span class="md-file md-path" data-tooltip="${esc(where)}">${label}</span>`;
      // A PR diff's anchor for a file is a hash of its path: the click works it out (see review.js).
      const diff = to.diff ? ` target="_blank" rel="noopener" data-action="open-diff" data-file="${esc(file)}" data-line="${esc(line)}"` : "";
      return `<a class="md-file" href="${esc(to.href)}" data-tooltip="${esc(where)}"${diff}>${label}</a>`;
    },
    // A quote is often something to paste (a review comment, a reply): it gets a Copy button. One that
    // follows a line holding only a link (`cite`, see markdown()) is a comment on that file: a card with the
    // link in its header.
    blockquote({ tokens, raw, cite }) {
      const text = esc(raw.replace(/^ {0,3}> ?/gm, "").trim());
      const copy = `<button class="md-quote__copy" type="button" data-action="copy-quote">Copy</button>`;
      if (cite) return `<figure class="md-comment" data-copy="${text}"><figcaption class="md-comment__head">${this.parser.parseInline([cite])}${copy}</figcaption><blockquote class="md-comment__body">${this.parser.parse(tokens)}</blockquote></figure>`;
      return `<blockquote class="md-quote" data-copy="${text}">${this.parser.parse(tokens)}${copy}</blockquote>`;
    },
    // No pictures in answers: an image is a link to it.
    image: ({ href, text }) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text || href)}</a>`,
    // Task items are styled boxes (style.css), not form controls.
    listitem(item) {
      const task = item.task ? ` class="is-task${item.checked ? " is-done" : ""}"` : "";
      return `<li${task}>${this.parser.parse(item.tokens)}</li>`;
    },
    checkbox: () => "",
    table(token) {
      return `<div class="table">${Renderer.prototype.table.call(this, token)}</div>`;
    },
  },
});

// DOMPurify's own list of safe link protocols, plus vscode: for opening files in VS Code.
const SAFE_URL = /^(?:(?:https?|mailto|tel|vscode):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/**
 * Markdown as safe HTML. `files(path, line)` says where links to files in the repo go: `{ href }`, or
 * `{ href, diff: true }` for a PR's Files changed view; null leaves them as plain labels. `transform(tokens)`
 * can reshape the parsed blocks first (see marked's lexer), and returns them.
 */
export function markdown(src, { files: where = null, transform = (tokens) => tokens } = {}) {
  lastLang = "";
  files = where;
  const tokens = transform(md.lexer(String(src || "")));
  return DOMPurify.sanitize(md.parser(withCites(tokens)), { ADD_ATTR: ["target"], ALLOWED_URI_REGEXP: SAFE_URL });
}

/**
 * A line holding only a link (bold or not), then a quote: the link becomes the quote's `cite`, for blockquote()
 * above. Inside list items too, as Bob often numbers its comments ("1. [file](…)" with the quote under it).
 */
function withCites(tokens) {
  for (const t of tokens) if (t.type === "list") t.items.forEach((item) => withCites(item.tokens));
  for (let i = 0; i < tokens.length; i++) {
    // A list item's first line is a "text" token, a paragraph's a "paragraph".
    let only = ["paragraph", "text"].includes(tokens[i].type) && tokens[i].tokens?.filter((t) => t.type !== "text" || t.text.trim());
    if (only?.length === 1 && only[0].type === "strong") only = only[0].tokens;
    let next = i + 1;
    while (tokens[next]?.type === "space") next++;
    if (only?.length === 1 && only[0].type === "link" && tokens[next]?.type === "blockquote") {
      tokens[next].cite = only[0];
      tokens.splice(i, next - i);
    }
  }
  return tokens;
}

/** Unchecked "- [ ] …" items, as plain to-do text. */
export function checklist(text) {
  const todos = [];
  md.walkTokens(md.lexer(String(text || "")), (t) => {
    if (t.type !== "list_item" || !t.task || t.checked) return;
    const line = t.text.replace(/^\[ \]\s*/, "").split("\n")[0];
    todos.push(
      line
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*|`/g, "")
        .trim()
    );
  });
  return todos.filter(Boolean);
}
