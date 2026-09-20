import panelCss from "./content.css";
import brandIcon from "../extension/icons/mark.svg";

export const svg = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
export const matchesIcon = svg('<path d="M4 6h10M4 11h10M4 16h7"/><path d="m16 15 3 3 3-3"/>');
const closeIcon = svg('<path d="m6 6 12 12M18 6 6 18"/>');
const upIcon = svg('<path d="m6 14 6-6 6 6"/>');
const downIcon = svg('<path d="m6 10 6 6 6-6"/>');

export function searchBar({ unavailable = false } = {}) {
  const content = unavailable
    ? '<span class="unavailable-message" role="status" data-i18n="search.unavailable">This page is not supported.</span>'
    : `<div class="input-wrap"><input maxlength="400" aria-label="Search this page" data-i18n-aria-label="search.input" placeholder="Search meaning · Enter" data-i18n-placeholder="search.placeholder" autocomplete="off" spellcheck="false"></div>
      <span class="count" role="status" aria-live="polite"></span>
      <span class="divider" aria-hidden="true"></span>
      <button class="icon prev" type="button" aria-label="Previous match" data-i18n-aria-label="search.previous" title="Previous match · Shift+Enter" data-i18n-title="search.previousTitle" disabled>${upIcon}</button>
      <button class="icon next" type="button" aria-label="Next match" data-i18n-aria-label="search.next" title="Next match · Enter" data-i18n-title="search.nextTitle" disabled>${downIcon}</button>
      <button class="icon expand" type="button" aria-label="Show ranked matches" data-i18n-aria-label="search.showMatches" title="Show ranked matches" data-i18n-title="search.showMatches" aria-expanded="false">${matchesIcon}</button>`;
  const bar = `<div class="bar">
    <div class="brand-mark" title="Senseek" aria-hidden="true">${brandIcon}</div>
    ${content}
    <button class="icon close" type="button" aria-label="Close search" data-i18n-aria-label="search.close" title="Close · Esc" data-i18n-title="search.closeTitle">${closeIcon}</button>
  </div>`;
  return unavailable ? bar : `<form class="search">${bar}</form>`;
}

// Both the page overlay and the restricted-page popup use this same component.
// Only extension-owned markup is passed here; page/API text uses textContent.
export function mountPanel(host, content) {
  const shadow = host.attachShadow({ mode: "open" });
  const style = new CSSStyleSheet();
  style.replaceSync(panelCss);
  shadow.adoptedStyleSheets = [style];
  shadow.innerHTML = `<section class="panel" part="panel" role="dialog" aria-label="Senseek page search" data-i18n-aria-label="search.dialog">${content}</section>`;
  return shadow;
}
