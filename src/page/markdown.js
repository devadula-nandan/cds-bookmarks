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
    // Web links open in a new tab, a bare GitHub URL without its "https://github.com/"; a link to a file path in
    // the repo (Bob citing code) is the label, with the path on hover.
    link({ href, text, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!/^https?:\/\//i.test(href)) return `<span class="md-path" data-tooltip="${esc(href)}">${label}</span>`;
      const shown = text === href ? esc(href.replace(/^https:\/\/(www\.)?github\.com\//, "")) : label;
      return `<a href="${esc(href)}" target="_blank" rel="noopener">${shown}</a>`;
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

/** Markdown as safe HTML. */
export function markdown(src) {
  lastLang = "";
  return DOMPurify.sanitize(md.parse(String(src || "")), { ADD_ATTR: ["target"] });
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
