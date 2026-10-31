// lit-html, the page's templating. Every view is an `html` template that `render` updates in place: only what
// changed is touched, so focus, typed text, scroll positions and opened sections survive a re-render, and every
// value is escaped unless it's passed through `unsafeHTML` (sanitized Markdown) or `unsafeSVG` (icons, logos).

export { html, nothing, render } from "../vendor/lit-html/lit-html.js";
export { live } from "../vendor/lit-html/directives/live.js";
export { repeat } from "../vendor/lit-html/directives/repeat.js";
export { unsafeHTML } from "../vendor/lit-html/directives/unsafe-html.js";
export { unsafeSVG } from "../vendor/lit-html/directives/unsafe-svg.js";
