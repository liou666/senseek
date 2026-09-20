import { normalizeThreshold, searchPage, SearchError, verifyKey } from "./core/search.js";
import { normalizeLanguage, translate } from "./core/i18n.js";

// Content scripts never receive the key, nor permission to read local storage.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const pending = new Map();
const slotFor = (sender) => `${sender.tab.id}:${sender.frameId ?? 0}`;

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});

async function resetAction(tabId) {
  const { language } = await chrome.storage.local.get("language");
  await Promise.all([
    chrome.action.setPopup({ tabId, popup: "" }),
    chrome.action.setTitle({ tabId, title: translate(language, "app.actionTitle") }),
    chrome.action.setBadgeText({ tabId, text: "" }),
  ]);
}

async function toggleSearch(tab) {
  if (tab.id === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch {
    // Restricted pages reject all content scripts. Use the browser-owned
    // toolbar popup for the same compact message without leaving the page.
    try {
      const current = await chrome.tabs.get(tab.id);
      if (tab.url && current.url && tab.url !== current.url) return;
      const { language } = await chrome.storage.local.get("language");
      await chrome.action.setPopup({ tabId: tab.id, popup: "unavailable.html" });
      await chrome.action.setTitle({ tabId: tab.id, title: translate(language, "app.unavailableTitle") });
      if (current.active) await chrome.action.openPopup({ windowId: current.windowId });
    } catch { /* The tab or its window may have closed during the request. */ }
    return;
  }
  await resetAction(tab.id).catch(() => {});
}
chrome.action.onClicked.addListener(toggleSearch);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== "string") return;
  const trustedOptions = sender.url?.split("?")[0] === chrome.runtime.getURL("options.html");
  if (message.type === "JEV_OPEN_SETTINGS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "JEV_CANCEL" && sender.tab) {
    const current = pending.get(slotFor(sender));
    if (current?.id === message.requestId) current.controller.abort();
    sendResponse({ ok: true });
    return;
  }
  if (!["JEV_STATUS", "JEV_SEARCH", "JEV_VERIFY_KEY"].includes(message.type)) return;
  if (message.type === "JEV_VERIFY_KEY" && !trustedOptions) return;
  if (message.type === "JEV_SEARCH" && (!sender.tab || sender.frameId !== 0 || !/^https?:|^file:/.test(sender.url || ""))) return;

  let entry, slot;
  if (message.type === "JEV_SEARCH") {
    if (typeof message.requestId !== "string" || message.requestId.length > 80) return;
    slot = slotFor(sender);
    pending.get(slot)?.controller.abort();
    entry = { id: message.requestId, controller: new AbortController() };
    pending.set(slot, entry);
  }
  (async () => {
    try {
      await storageReady;
      if (message.type === "JEV_VERIFY_KEY") return sendResponse(await verifyKey(message.key));
      const { apiKey = "", threshold, language } = await chrome.storage.local.get(["apiKey", "threshold", "language"]);
      if (message.type === "JEV_STATUS") return sendResponse({ configured: Boolean(apiKey), threshold: normalizeThreshold(threshold), language: normalizeLanguage(language) });
      const result = await searchPage(message.payload, { key: apiKey, threshold, signal: entry.controller.signal });
      sendResponse(result);
    } catch (error) {
      const messageKey = error.name === "AbortError" ? "error.cancelled" : error instanceof SearchError ? error.messageKey : "error.internal";
      sendResponse({
        error: translate("en", messageKey, error.params),
        messageKey,
        params: error instanceof SearchError ? error.params : {},
        code: error.name === "AbortError" ? "CANCELLED" : error instanceof SearchError ? error.code : "INTERNAL_ERROR",
      });
    } finally {
      if (slot && pending.get(slot) === entry) pending.delete(slot);
    }
  })();
  return true;
});

function cancelTab(tabId) {
  for (const [slot, entry] of pending) {
    if (slot.startsWith(`${tabId}:`)) { entry.controller.abort(); pending.delete(slot); }
  }
}
chrome.tabs.onRemoved.addListener(cancelTab);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" || change.url) {
    cancelTab(tabId);
    // A failure on one page must not keep the notice popup on the next page.
    void resetAction(tabId).catch(() => {});
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.apiKey) {
    for (const entry of pending.values()) entry.controller.abort();
    pending.clear();
  }
  if (area === "local" && changes.language) void updateLanguage(changes.language.newValue);
});

async function updateLanguage(value) {
  const language = normalizeLanguage(value);
  await chrome.action.setTitle({ title: translate(language, "app.actionTitle") });
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter((tab) => tab.id !== undefined).map(async (tab) => {
    const popup = await chrome.action.getPopup({ tabId: tab.id });
    await chrome.action.setTitle({ tabId: tab.id, title: translate(language, popup ? "app.unavailableTitle" : "app.actionTitle") });
    await chrome.tabs.sendMessage(tab.id, { type: "JEV_LANGUAGE", language }, { frameId: 0 }).catch(() => {});
  }));
}
void storageReady.then(async () => {
  const { language } = await chrome.storage.local.get("language");
  await updateLanguage(language);
}).catch(() => {});
