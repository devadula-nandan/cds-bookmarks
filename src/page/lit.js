// lit-html, the page's templating, from the Carbon bundle (the same copy Carbon's web components run on).
// Every view is an `html` template that `render` updates in place: only what changed is touched, so focus,
// typed text, scroll positions and opened sections survive a re-render, and every value is escaped unless
// it's passed through `unsafeHTML` (sanitized Markdown) or `unsafeSVG` (icons, logos).

export { html, live, nothing, render, repeat, unsafeHTML, unsafeSVG } from "../vendor/carbon/carbon.js";
