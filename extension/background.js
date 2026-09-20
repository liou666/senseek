import { normalizeThreshold, searchPage, SearchError, verifyKey } from "./core/search.js";

// Content scripts never receive the key, nor permission to read local storage.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const pending = new Map();
const slotFor = (sender) => `${sender.tab.id}:${sender.frameId ?? 0}`;

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL("options.html?notice=unsupported") });
  }
});

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
      const { apiKey = "", threshold } = await chrome.storage.local.get(["apiKey", "threshold"]);
      if (message.type === "JEV_STATUS") return sendResponse({ configured: Boolean(apiKey), threshold: normalizeThreshold(threshold) });
      const result = await searchPage(message.payload, { key: apiKey, threshold, signal: entry.controller.signal });
      sendResponse(result);
    } catch (error) {
      sendResponse({
        error: error.name === "AbortError" ? "Search canceled." : error instanceof SearchError ? error.message : "Search could not finish. Reopen the extension and try again.",
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
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === "loading") cancelTab(tabId); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.apiKey) {
    for (const entry of pending.values()) entry.controller.abort();
    pending.clear();
  }
});
