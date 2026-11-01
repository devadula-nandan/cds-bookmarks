// The dashboard's Carbon bundle (built by build.sh into src/vendor/carbon/carbon.js): the Carbon web components
// the page is made of (registered on import), lit-html for its own templates (the same copy the components run
// on), and the Carbon icons it draws.

import "@carbon/web-components/es/components/accordion/index.js";
import "@carbon/web-components/es/components/ai-label/index.js";
import "@carbon/web-components/es/components/ai-skeleton/index.js";
import "@carbon/web-components/es/components/badge-indicator/index.js";
import "@carbon/web-components/es/components/button/index.js";
import "@carbon/web-components/es/components/checkbox/index.js";
import "@carbon/web-components/es/components/code-snippet/index.js";
import "@carbon/web-components/es/components/contained-list/index.js";
import "@carbon/web-components/es/components/content-switcher/index.js";
import "@carbon/web-components/es/components/copy-button/index.js";
import "@carbon/web-components/es/components/data-table/index.js";
import "@carbon/web-components/es/components/form-group/index.js";
import "@carbon/web-components/es/components/grid/index.js";
import "@carbon/web-components/es/components/icon-button/index.js";
import "@carbon/web-components/es/components/inline-loading/index.js";
import "@carbon/web-components/es/components/layer/index.js";
import "@carbon/web-components/es/components/link/index.js";
import "@carbon/web-components/es/components/list/index.js";
import "@carbon/web-components/es/components/loading/index.js";
import "@carbon/web-components/es/components/menu/index.js";
import "@carbon/web-components/es/components/menu-button/index.js";
import "@carbon/web-components/es/components/modal/index.js";
import "@carbon/web-components/es/components/notification/index.js";
import "@carbon/web-components/es/components/number-input/index.js";
import "@carbon/web-components/es/components/overflow-menu/index.js";
import "@carbon/web-components/es/components/password-input/index.js";
import "@carbon/web-components/es/components/progress-indicator/index.js";
import "@carbon/web-components/es/components/search/index.js";
import "@carbon/web-components/es/components/select/index.js";
import "@carbon/web-components/es/components/skeleton-text/index.js";
import "@carbon/web-components/es/components/skip-to-content/index.js";
import "@carbon/web-components/es/components/structured-list/index.js";
import "@carbon/web-components/es/components/tabs/index.js";
import "@carbon/web-components/es/components/tag/index.js";
import "@carbon/web-components/es/components/text-input/index.js";
import "@carbon/web-components/es/components/textarea/index.js";
import "@carbon/web-components/es/components/tile/index.js";
import "@carbon/web-components/es/components/toggle/index.js";
import "@carbon/web-components/es/components/tooltip/index.js";
import "@carbon/web-components/es/components/ui-shell/index.js";

export { html, nothing, render, svg } from "lit";
export { ifDefined } from "lit/directives/if-defined.js";
export { live } from "lit/directives/live.js";
export { repeat } from "lit/directives/repeat.js";
export { unsafeHTML } from "lit/directives/unsafe-html.js";
export { unsafeSVG } from "lit/directives/unsafe-svg.js";
export { toString as iconString, getAttributes as iconAttributes } from "@carbon/icon-helpers";

import view16 from "@carbon/icons/es/view/16.js";
import view20 from "@carbon/icons/es/view/20.js";
import viewFilled16 from "@carbon/icons/es/view--filled/16.js";
import viewFilled20 from "@carbon/icons/es/view--filled/20.js";
import pullRequest16 from "@carbon/icons/es/pull-request/16.js";
import pullRequest20 from "@carbon/icons/es/pull-request/20.js";
import draft16 from "@carbon/icons/es/result--draft/16.js";
import draft20 from "@carbon/icons/es/result--draft/20.js";
import merge16 from "@carbon/icons/es/merge/16.js";
import merge20 from "@carbon/icons/es/merge/20.js";
import circleDash16 from "@carbon/icons/es/circle-dash/16.js";
import circleDash20 from "@carbon/icons/es/circle-dash/20.js";
import notification16 from "@carbon/icons/es/notification/16.js";
import notification20 from "@carbon/icons/es/notification/20.js";
import renew16 from "@carbon/icons/es/renew/16.js";
import renew20 from "@carbon/icons/es/renew/20.js";
import search16 from "@carbon/icons/es/search/16.js";
import search20 from "@carbon/icons/es/search/20.js";
import checkmark16 from "@carbon/icons/es/checkmark/16.js";
import checkmark20 from "@carbon/icons/es/checkmark/20.js";
import checkmarkFilled16 from "@carbon/icons/es/checkmark--filled/16.js";
import checkmarkFilled20 from "@carbon/icons/es/checkmark--filled/20.js";
import close16 from "@carbon/icons/es/close/16.js";
import close20 from "@carbon/icons/es/close/20.js";
import warning16 from "@carbon/icons/es/warning--alt/16.js";
import warning20 from "@carbon/icons/es/warning--alt/20.js";
import warningFilled16 from "@carbon/icons/es/warning--alt--filled/16.js";
import warningFilled20 from "@carbon/icons/es/warning--alt--filled/20.js";
import errorFilled16 from "@carbon/icons/es/error--filled/16.js";
import errorFilled20 from "@carbon/icons/es/error--filled/20.js";
import time16 from "@carbon/icons/es/time/16.js";
import time20 from "@carbon/icons/es/time/20.js";
import arrowRight16 from "@carbon/icons/es/arrow--right/16.js";
import arrowRight20 from "@carbon/icons/es/arrow--right/20.js";
import arrowUp16 from "@carbon/icons/es/arrow--up/16.js";
import arrowUp20 from "@carbon/icons/es/arrow--up/20.js";
import arrowDown16 from "@carbon/icons/es/arrow--down/16.js";
import arrowDown20 from "@carbon/icons/es/arrow--down/20.js";
import copy16 from "@carbon/icons/es/copy/16.js";
import copy20 from "@carbon/icons/es/copy/20.js";
import link16 from "@carbon/icons/es/link/16.js";
import link20 from "@carbon/icons/es/link/20.js";
import chat16 from "@carbon/icons/es/chat/16.js";
import chat20 from "@carbon/icons/es/chat/20.js";
import at16 from "@carbon/icons/es/at/16.js";
import at20 from "@carbon/icons/es/at/20.js";
import tag16 from "@carbon/icons/es/tag/16.js";
import tag20 from "@carbon/icons/es/tag/20.js";
import calendar16 from "@carbon/icons/es/calendar/16.js";
import calendar20 from "@carbon/icons/es/calendar/20.js";
import add16 from "@carbon/icons/es/add/16.js";
import add20 from "@carbon/icons/es/add/20.js";
import subtract16 from "@carbon/icons/es/subtract/16.js";
import subtract20 from "@carbon/icons/es/subtract/20.js";
import trashCan16 from "@carbon/icons/es/trash-can/16.js";
import trashCan20 from "@carbon/icons/es/trash-can/20.js";
import edit16 from "@carbon/icons/es/edit/16.js";
import edit20 from "@carbon/icons/es/edit/20.js";
import activity16 from "@carbon/icons/es/activity/16.js";
import activity20 from "@carbon/icons/es/activity/20.js";
import chevronDown16 from "@carbon/icons/es/chevron--down/16.js";
import chevronDown20 from "@carbon/icons/es/chevron--down/20.js";
import user16 from "@carbon/icons/es/user/16.js";
import user20 from "@carbon/icons/es/user/20.js";
import book16 from "@carbon/icons/es/book/16.js";
import book20 from "@carbon/icons/es/book/20.js";
import earth16 from "@carbon/icons/es/earth/16.js";
import earth20 from "@carbon/icons/es/earth/20.js";
import asleep16 from "@carbon/icons/es/asleep/16.js";
import asleep20 from "@carbon/icons/es/asleep/20.js";
import snooze16 from "@carbon/icons/es/snooze/16.js";
import snooze20 from "@carbon/icons/es/snooze/20.js";
import settings16 from "@carbon/icons/es/settings/16.js";
import settings20 from "@carbon/icons/es/settings/20.js";
import debug16 from "@carbon/icons/es/debug/16.js";
import debug20 from "@carbon/icons/es/debug/20.js";
import logoSlack16 from "@carbon/icons/es/logo--slack/16.js";
import logoSlack20 from "@carbon/icons/es/logo--slack/20.js";
import code16 from "@carbon/icons/es/code/16.js";
import code20 from "@carbon/icons/es/code/20.js";
import aiGenerate16 from "@carbon/icons/es/ai-generate/16.js";
import aiGenerate20 from "@carbon/icons/es/ai-generate/20.js";
import send16 from "@carbon/icons/es/send/16.js";
import send20 from "@carbon/icons/es/send/20.js";
import branch16 from "@carbon/icons/es/branch/16.js";
import branch20 from "@carbon/icons/es/branch/20.js";
import logoGithub16 from "@carbon/icons/es/logo--github/16.js";
import logoGithub20 from "@carbon/icons/es/logo--github/20.js";
import launch16 from "@carbon/icons/es/launch/16.js";
import launch20 from "@carbon/icons/es/launch/20.js";
import minimize16 from "@carbon/icons/es/minimize/16.js";
import minimize20 from "@carbon/icons/es/minimize/20.js";
import undo16 from "@carbon/icons/es/undo/16.js";
import undo20 from "@carbon/icons/es/undo/20.js";
import checkbox16 from "@carbon/icons/es/checkbox/16.js";
import checkbox20 from "@carbon/icons/es/checkbox/20.js";
import checkboxChecked16 from "@carbon/icons/es/checkbox--checked/16.js";
import checkboxChecked20 from "@carbon/icons/es/checkbox--checked/20.js";
import informationFilled16 from "@carbon/icons/es/information--filled/16.js";
import informationFilled20 from "@carbon/icons/es/information--filled/20.js";

/** Carbon icons by the dashboard's name for them, at 16 and 20px. */
export const icons = {
  view: { 16: view16, 20: view20 },
  viewFilled: { 16: viewFilled16, 20: viewFilled20 },
  pullRequest: { 16: pullRequest16, 20: pullRequest20 },
  draft: { 16: draft16, 20: draft20 },
  merge: { 16: merge16, 20: merge20 },
  circleDash: { 16: circleDash16, 20: circleDash20 },
  notification: { 16: notification16, 20: notification20 },
  renew: { 16: renew16, 20: renew20 },
  search: { 16: search16, 20: search20 },
  checkmark: { 16: checkmark16, 20: checkmark20 },
  checkmarkFilled: { 16: checkmarkFilled16, 20: checkmarkFilled20 },
  close: { 16: close16, 20: close20 },
  warning: { 16: warning16, 20: warning20 },
  warningFilled: { 16: warningFilled16, 20: warningFilled20 },
  errorFilled: { 16: errorFilled16, 20: errorFilled20 },
  time: { 16: time16, 20: time20 },
  arrowRight: { 16: arrowRight16, 20: arrowRight20 },
  arrowUp: { 16: arrowUp16, 20: arrowUp20 },
  arrowDown: { 16: arrowDown16, 20: arrowDown20 },
  copy: { 16: copy16, 20: copy20 },
  link: { 16: link16, 20: link20 },
  chat: { 16: chat16, 20: chat20 },
  at: { 16: at16, 20: at20 },
  tag: { 16: tag16, 20: tag20 },
  calendar: { 16: calendar16, 20: calendar20 },
  add: { 16: add16, 20: add20 },
  subtract: { 16: subtract16, 20: subtract20 },
  trashCan: { 16: trashCan16, 20: trashCan20 },
  edit: { 16: edit16, 20: edit20 },
  activity: { 16: activity16, 20: activity20 },
  chevronDown: { 16: chevronDown16, 20: chevronDown20 },
  user: { 16: user16, 20: user20 },
  book: { 16: book16, 20: book20 },
  earth: { 16: earth16, 20: earth20 },
  asleep: { 16: asleep16, 20: asleep20 },
  snooze: { 16: snooze16, 20: snooze20 },
  settings: { 16: settings16, 20: settings20 },
  debug: { 16: debug16, 20: debug20 },
  logoSlack: { 16: logoSlack16, 20: logoSlack20 },
  code: { 16: code16, 20: code20 },
  aiGenerate: { 16: aiGenerate16, 20: aiGenerate20 },
  send: { 16: send16, 20: send20 },
  branch: { 16: branch16, 20: branch20 },
  logoGithub: { 16: logoGithub16, 20: logoGithub20 },
  launch: { 16: launch16, 20: launch20 },
  minimize: { 16: minimize16, 20: minimize20 },
  undo: { 16: undo16, 20: undo20 },
  checkbox: { 16: checkbox16, 20: checkbox20 },
  checkboxChecked: { 16: checkboxChecked16, 20: checkboxChecked20 },
  informationFilled: { 16: informationFilled16, 20: informationFilled20 },
};

// Carbon pictograms for empty states (and the connect screen), by the dashboard's name for them.
import summitPictogram from "@carbon/pictograms/lib/summit/index.js";
import reviewChecklistPictogram from "@carbon/pictograms/lib/review-checklist/index.js";
import codePictogram from "@carbon/pictograms/lib/code/index.js";
import binocularPictogram from "@carbon/pictograms/lib/binocular/index.js";
import notificationsPictogram from "@carbon/pictograms/lib/notifications/index.js";
import connectPictogram from "@carbon/pictograms/lib/connect/index.js";

export const pictograms = {
  summit: summitPictogram,
  reviewChecklist: reviewChecklistPictogram,
  code: codePictogram,
  binocular: binocularPictogram,
  notifications: notificationsPictogram,
  connect: connectPictogram,
};
