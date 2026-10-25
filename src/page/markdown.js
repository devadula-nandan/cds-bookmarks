// Bob's answers as HTML: a small, escape-first Markdown renderer (headings, nested and task lists, tables,
// quotes, rules, code with syntax colours and diffs), and the to-dos in a checklist answer.

import { esc } from "../core.js";

function inline(text) {
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  // Link markup is set aside too, so an underscore or asterisk in a URL isn't read as emphasis.
  const tags = [];
  const keep = (html) => `\u0001${tags.push(html) - 1}\u0001`;
  s = esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => keep(`<a href="${url}" target="_blank" rel="noopener">`) + label + keep("</a>"))
    // A link to a file path in the repo (Bob citing code): the label, with the path on hover.
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, path) => keep(`<span class="md-path" data-tooltip="${path}">`) + label + keep("</span>"))
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => pre + keep(`<a href="${url}" target="_blank" rel="noopener">${url.replace(/^https:\/\/(www\.)?github\.com\//, "")}</a>`))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__([^_]+)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => tags[+i]).replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

// ---------- syntax highlighting: a small per-line tokenizer, good enough for answers and diffs ----------
const KEYWORDS = new Set(
  "const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this super null undefined true false void yield delete interface type enum implements public private protected readonly static as satisfies keyof declare abstract def elif lambda pass None True False self fi then esac done echo local".split(" ")
);
const LANG = { javascript: "js", typescript: "ts", mjs: "js", cjs: "js", bash: "sh", zsh: "sh", shell: "sh", python: "py", yml: "yaml", htm: "html", svg: "html", xml: "html", vue: "html" };
const CODE_LANGS = new Set(["js", "jsx", "ts", "tsx", "json", "css", "scss", "sh", "py", "yaml", "html"]);
const TAGS = new Set(["jsx", "tsx", "html"]);
const HASH_COMMENTS = new Set(["sh", "py", "yaml"]);

const langOf = (name) => {
  const l = String(name || "").toLowerCase();
  return LANG[l] || l;
};

function highlight(line, lang) {
  lang = langOf(lang);
  if (!CODE_LANGS.has(lang)) return esc(line);
  const parts = [
    HASH_COMMENTS.has(lang) ? "#.*$" : "\\/\\/.*$|\\/\\*.*?(?:\\*\\/|$)",
    "\"(?:\\\\.|[^\"\\\\])*\"?|'(?:\\\\.|[^'\\\\])*'?|`(?:\\\\.|[^`\\\\])*`?",
    "\\b\\d[\\d_.]*(?:px|rem|em|ms|s|%)?\\b",
    TAGS.has(lang) ? "<\\/?[A-Za-z][\\w.:-]*" : "(?!)",
    "[A-Za-z_$][\\w$-]*",
  ];
  const re = new RegExp(parts.map((p) => `(${p})`).join("|"), "g");
  let out = "";
  let last = 0;
  for (const m of line.matchAll(re)) {
    out += esc(line.slice(last, m.index));
    last = m.index + m[0].length;
    const [, comment, string, number, tag, word] = m;
    const cls = comment ? "c" : string ? "s" : number ? "n" : tag ? "t" : word && KEYWORDS.has(word) ? "k" : word && /^[\w$-]+\s*\(/.test(line.slice(m.index)) ? "f" : "";
    out += cls ? `<span class="tok-${cls}">${esc(m[0])}</span>` : esc(m[0]);
  }
  return out + esc(line.slice(last));
}

/** A fenced block with its language and a Copy button. Diffs tint added, removed and hunk lines and highlight the code in them. */
function codeBlock(lang, body) {
  const diff = /^(diff|patch)$/i.test(lang) || body.some((l) => /^@@ /.test(l));
  // A diff's code language: the fence's (```tsx with a diff in it) or the file's extension.
  const file = body.map((l) => l.match(/^(?:\+\+\+|---) (?:[ab]\/)?\S+\.(\w+)/)?.[1]).find(Boolean);
  const code = diff && /^(diff|patch)?$/i.test(lang) ? file : lang;
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
    : body.map((l) => highlight(l, lang)).join("\n");
  return `<div class="code"><div class="code__bar"><span>${esc(lang || "code")}</span><button class="code__copy" type="button" data-action="copy-code">Copy</button></div><pre><code>${html}</code></pre></div>`;
}

/** `| a | b |` → cells, without the outer pipes. */
function tableCells(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * A small, escape-first Markdown renderer: headings, nested and task lists, tables, quotes, rules, and code
 * (diffs coloured). Everything is escaped before any markup is added.
 */
export function markdown(src) {
  const lines = String(src || "")
    .replace(/\r/g, "")
    .replace(/\t/g, "    ")
    .split("\n");
  const out = [];
  let para = [];
  // Open lists, innermost last. Items stay open (no </li>) so a nested list or code block can go inside.
  const lists = [];
  let gap = false;
  const indentOf = (l) => l.match(/^ */)[0].length;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const closeLists = (above = -1) => {
    while (lists.length && lists.at(-1).indent > above) out.push(`</li></${lists.pop().tag}>`);
  };
  const closeAll = () => {
    flushPara();
    closeLists();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = indentOf(line);
    const inItem = lists.length && indent > lists.at(-1).indent;

    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/);
    if (fence) {
      flushPara();
      // Indented under a list item, the code belongs to that item.
      if (!inItem) closeLists();
      const body = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i].slice(Math.min(indent, indentOf(lines[i]))));
      out.push(codeBlock(fence[2], body));
      gap = false;
      continue;
    }

    if (!line.trim()) {
      flushPara();
      gap = true;
      continue;
    }

    const item = line.match(/^(\s*)(?:([-*+•])|(\d+)[.)])\s+(?:\[( |x|X)\]\s+)?(.*)/);
    if (item) {
      flushPara();
      const tag = item[3] ? "ol" : "ul";
      closeLists(indent);
      const top = lists.at(-1);
      if (top && top.indent === indent && top.tag !== tag) closeLists(indent - 1);
      if (lists.at(-1)?.indent === indent) out.push("</li>");
      else {
        lists.push({ tag, indent });
        out.push(tag === "ol" && item[3] !== "1" ? `<ol start="${+item[3]}">` : `<${tag}>`);
      }
      const task = item[4] !== undefined ? ` class="is-task${item[4].trim() ? " is-done" : ""}"` : "";
      out.push(`<li${task}>${inline(item[5])}`);
      gap = false;
      continue;
    }

    // A line that carries on the current list item: indented under it, or straight after it with no blank line.
    if (lists.length && (inItem || !gap) && !/^\s*(#{1,6}\s|>|\|)/.test(line)) {
      out.push(gap ? `<p>${inline(line.trim())}</p>` : `<br>${inline(line.trim())}`);
      gap = false;
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      closeAll();
      const tag = heading[1].length <= 2 ? "h3" : "h4";
      out.push(`<${tag}>${inline(heading[2])}</${tag}>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      closeAll();
      out.push("<hr>");
    } else if (line.includes("|") && TABLE_RULE.test(lines[i + 1] || "")) {
      closeAll();
      const head = tableCells(line);
      const align = tableCells(lines[++i]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : ""));
      const cell = (tag, text, j) => `<${tag}${align[j] ? ` style="text-align: ${align[j]}"` : ""}>${inline(text)}</${tag}>`;
      const rows = [];
      while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim()) rows.push(tableCells(lines[++i]));
      out.push(
        `<div class="table"><table><thead><tr>${head.map((c, j) => cell("th", c, j)).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_, j) => cell("td", r[j] || "", j)).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      );
    } else if (/^\s*>/.test(line)) {
      closeAll();
      const body = [line.replace(/^\s*>\s?/, "")];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) body.push(lines[++i].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${markdown(body.join("\n"))}</blockquote>`);
    } else {
      closeLists();
      para.push(line.trim());
    }
    gap = false;
  }
  closeAll();
  return out.join("");
}

/** Unchecked "- [ ] …" lines, as plain to-do text. */
export function checklist(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.match(/^\s*[-*+]\s+\[ \]\s+(.*)/)?.[1])
    .filter(Boolean)
    .map((t) =>
      t
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*|`/g, "")
        .trim()
    );
}
