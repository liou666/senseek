import { DEFAULT_THRESHOLD, normalizeThreshold, validateKey } from "./core/search.js";
import { getShortcut, openShortcuts } from "./core/shortcuts.js";
import { localize, normalizeLanguage, setMessage } from "./core/i18n.js";

const $ = (selector) => document.querySelector(selector);
$("#version").textContent = `v${chrome.runtime.getManifest().version}`;
const keyInput = $("#api-key"), status = $("#status"), threshold = $("#threshold");
const verifyButton = $("#verify"), removeButton = $("#remove-key"), resetButton = $("#reset-preferences");
let ready = false, savedKey = "", verifying = false;
let keyRevision = 0, thresholdRevision = 0, verificationRevision = 0, languageRevision = 0;
let language = "en", savedLanguage = "en";
let writes = Promise.resolve();
const languageInput = $("#language");
const text = (element, key, params = {}) => setMessage(element, key, params, language);

function setStatus(key, kind = "", params = {}) { text(status, key, params); status.className = `status ${kind}`; }
function setKeyState(key) {
  $("#key-state").classList.toggle("saved", key === "state.saved");
  text($("#key-state span"), key);
}
function syncKeyControls() {
  let valid = false;
  try { valid = Boolean(validateKey(keyInput.value)); } catch { /* Keep incomplete input editable. */ }
  verifyButton.disabled = !ready || verifying || !valid;
  text(verifyButton, verifying ? "settings.verifying" : "settings.verify");
  verifyButton.setAttribute("aria-busy", String(verifying));
  removeButton.disabled = !ready || (!savedKey && !keyInput.value);
}
function syncThreshold() {
  $("#threshold-output").value = `${threshold.value}%`;
  resetButton.disabled = !ready || Number(threshold.value) === Math.round(DEFAULT_THRESHOLD * 100);
}
function setPreferenceStatus(key, kind = "") {
  text($("#preference-status"), key);
  $("#preference-status").className = `status ${kind}`;
}
function persist(write) {
  const pending = writes.then(write);
  // Keep later edits writable even if an earlier storage operation failed.
  writes = pending.catch(() => {});
  return pending;
}

async function saveKey() {
  const current = ++keyRevision;
  try {
    const apiKey = keyInput.value.trim() ? validateKey(keyInput.value) : "";
    setKeyState("state.saving");
    setStatus("");
    syncKeyControls();
    await persist(async () => {
      if (current !== keyRevision) return;
      if (apiKey) await chrome.storage.local.set({ apiKey });
      else await chrome.storage.local.remove("apiKey");
      savedKey = apiKey;
    });
    if (current !== keyRevision) return false;
    setKeyState(apiKey ? "state.saved" : "state.notConfigured");
    return true;
  } catch (error) {
    if (current === keyRevision) {
      setKeyState("state.notSaved");
      setStatus(error.messageKey || "error.saveKey", "error", error.params);
    }
    return false;
  } finally { syncKeyControls(); }
}

function keyChanged() {
  verificationRevision++;
  verifying = false;
  void saveKey();
}
keyInput.addEventListener("input", keyChanged);
keyInput.addEventListener("change", () => { if (keyInput.value !== savedKey) keyChanged(); });

async function saveThreshold(reset = false) {
  const current = ++thresholdRevision;
  const value = normalizeThreshold(Number(threshold.value) / 100);
  syncThreshold();
  setPreferenceStatus("state.saving");
  try {
    await persist(async () => {
      if (current === thresholdRevision) await chrome.storage.local.set({ threshold: value });
    });
    if (current === thresholdRevision) setPreferenceStatus(reset ? "state.reset" : "state.savedNotice", "success");
  } catch {
    if (current === thresholdRevision) setPreferenceStatus("error.savePreferences", "error");
  }
}
threshold.addEventListener("input", () => { void saveThreshold(); });
resetButton.addEventListener("click", () => {
  threshold.value = String(Math.round(DEFAULT_THRESHOLD * 100));
  void saveThreshold(true);
});

$("#toggle-key").addEventListener("click", () => {
  const reveal = keyInput.type === "password";
  keyInput.type = reveal ? "text" : "password";
  $("#toggle-key").setAttribute("data-i18n-aria-label", reveal ? "settings.hideKey" : "settings.showKey");
  $("#toggle-key").setAttribute("aria-pressed", String(reveal));
  localize(document, language);
});

function applyLanguage(value) {
  language = normalizeLanguage(value);
  document.documentElement.lang = language;
  languageInput.value = language;
  localize(document, language);
}

languageInput.addEventListener("change", async () => {
  const current = ++languageRevision;
  const next = normalizeLanguage(languageInput.value);
  applyLanguage(next);
  text($("#language-status"), "state.saving");
  $("#language-status").className = "status";
  try {
    await persist(async () => {
      if (current !== languageRevision) return;
      await chrome.storage.local.set({ language: next });
      savedLanguage = next;
    });
    if (current === languageRevision) text($("#language-status"), "");
  } catch {
    if (current !== languageRevision) return;
    applyLanguage(savedLanguage);
    text($("#language-status"), "error.saveLanguage");
    $("#language-status").className = "status error";
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.language) return;
  savedLanguage = normalizeLanguage(changes.language.newValue);
  // An older write must not roll back a newer selection that is still saving.
  if ($("#language-status").dataset.i18n !== "state.saving") applyLanguage(savedLanguage);
});

async function initialize() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    const stored = await chrome.storage.local.get(["apiKey", "threshold", "language"]);
    savedLanguage = normalizeLanguage(stored.language);
    applyLanguage(savedLanguage);
    savedKey = stored.apiKey || "";
    keyInput.value = savedKey;
    threshold.value = String(Math.round(normalizeThreshold(stored.threshold) * 100));
    setKeyState(savedKey ? "state.saved" : "state.notConfigured");
  } catch { setStatus("error.loadSettings", "error"); }
  finally {
    ready = true;
    keyInput.disabled = false;
    threshold.disabled = false;
    languageInput.disabled = false;
    $("#toggle-key").disabled = false;
    syncKeyControls();
    syncThreshold();
  }
}

$("#settings").addEventListener("submit", (event) => { event.preventDefault(); });
verifyButton.addEventListener("click", async () => {
  const current = ++verificationRevision;
  verifying = true;
  syncKeyControls();
  try {
    const key = validateKey(keyInput.value);
    if (!await saveKey() || current !== verificationRevision) return;
    setStatus("settings.checkingKey");
    const response = await chrome.runtime.sendMessage({ type: "JEV_VERIFY_KEY", key });
    if (current !== verificationRevision) return;
    if (!response?.ok) throw Object.assign(new Error(), { messageKey: response?.messageKey || "error.verifyKey", params: response?.params });
    setStatus("settings.verified", "success");
  } catch (error) { if (current === verificationRevision) setStatus(error.messageKey || "error.verifyKey", "error", error.params); }
  finally {
    if (current === verificationRevision) {
      verifying = false;
      syncKeyControls();
    }
  }
});

removeButton.addEventListener("click", () => {
  keyInput.value = "";
  keyInput.type = "password";
  $("#toggle-key").setAttribute("data-i18n-aria-label", "settings.showKey");
  $("#toggle-key").setAttribute("aria-pressed", "false");
  localize(document, language);
  keyChanged();
});

async function refreshShortcut() {
  const shortcut = await getShortcut();
  if (shortcut) {
    delete $("#shortcut").dataset.i18n;
    $("#shortcut").textContent = shortcut;
  } else text($("#shortcut"), "settings.unassigned");
  $("#shortcut-help").hidden = Boolean(shortcut);
}
$("#configure-shortcut").onclick = openShortcuts;
window.addEventListener("focus", () => { void refreshShortcut(); });
void refreshShortcut();
initialize();
