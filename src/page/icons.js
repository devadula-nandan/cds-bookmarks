// Carbon icons (@carbon/icons, in the Carbon bundle), used as icon("name", size) in templates. `slot` puts
// the icon in a Carbon component's icon slot, such as a button's; `cls` replaces its "icon" class.

import { iconAttributes, iconString, icons } from "../vendor/carbon/carbon.js";
import { unsafeSVG } from "./lit.js";

/** The dashboard's names for Carbon's icons. */
const NAMES = {
  eye: "view",
  eyes: "viewFilled",
  pr: "pullRequest",
  draft: "draft",
  merge: "merge",
  issue: "circleDash",
  bell: "notification",
  refresh: "renew",
  search: "search",
  check: "checkmark",
  x: "close",
  alert: "warning",
  clock: "time",
  arrowRight: "arrowRight",
  arrowUp: "arrowUp",
  arrowDown: "arrowDown",
  copy: "copy",
  link: "link",
  message: "chat",
  at: "at",
  tag: "tag",
  calendar: "calendar",
  plus: "add",
  minus: "subtract",
  trash: "trashCan",
  edit: "edit",
  activity: "activity",
  chevronDown: "chevronDown",
  user: "user",
  book: "book",
  globe: "earth",
  moon: "asleep",
  snooze: "snooze",
  gear: "settings",
  bug: "debug",
  slack: "logoSlack",
  code: "code",
  sparkle: "aiGenerate",
  send: "send",
  git: "branch",
  github: "logoGithub",
  launch: "launch",
  undo: "undo",
};

const cache = new Map();

export function icon(name, size = 16, { slot = "", cls = "icon" } = {}) {
  const key = `${name}:${size}:${slot}:${cls}`;
  if (!cache.has(key)) {
    const set = icons[NAMES[name] || name] || icons.branch;
    const glyph = set[size >= 20 ? 20 : 16];
    const attrs = iconAttributes({ ...glyph.attrs, width: size, height: size, class: cls, "aria-hidden": "true", ...(slot ? { slot } : {}) });
    cache.set(key, unsafeSVG(iconString({ ...glyph, attrs })));
  }
  return cache.get(key);
}
