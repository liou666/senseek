import { mountPanel, searchBar } from "./search-bar.js";
import { localize, normalizeLanguage, translate } from "../extension/core/i18n.js";

const shadow = mountPanel(document.querySelector("#senseek"), searchBar({ unavailable: true }));
function applyLanguage(value) {
  const language = normalizeLanguage(value);
  document.documentElement.lang = language;
  document.querySelector("#senseek").lang = language;
  document.title = translate(language, "app.unavailableTitle");
  localize(shadow, language);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.language) applyLanguage(changes.language.newValue);
});
void chrome.storage.local.get("language").then(({ language }) => applyLanguage(language)).catch(() => {});
shadow.querySelector(".close").addEventListener("click", () => window.close());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.isComposing) {
    event.preventDefault();
    window.close();
  }
});
