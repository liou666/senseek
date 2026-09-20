import { normalizeThreshold, validateKey } from "./core/search.js";

const $ = (selector) => document.querySelector(selector);
const keyInput = $("#api-key"), status = $("#status"), threshold = $("#threshold");
const controls = [$("#save"), $("#verify"), $("#remove-key")];
let hasSavedKey = false, operation = 0;

function setStatus(text, kind = "") { status.textContent = text; status.className = `status ${kind}`; }
function setSaved(saved) {
  hasSavedKey = saved;
  $("#key-state").classList.toggle("saved", saved);
  $("#key-state span").textContent = saved ? "Saved" : "Not configured";
  $("#remove-key").disabled = !saved;
}
function setBusy(busy) {
  for (const control of controls) control.disabled = busy;
  if (!busy) $("#remove-key").disabled = !hasSavedKey;
  keyInput.disabled = busy;
  threshold.disabled = busy;
}
function syncThreshold() { $("#threshold-output").value = `${threshold.value}%`; }
threshold.addEventListener("input", syncThreshold);
$("#toggle-key").addEventListener("click", () => {
  const reveal = keyInput.type === "password";
  keyInput.type = reveal ? "text" : "password";
  $("#toggle-key").setAttribute("aria-label", reveal ? "Hide API key" : "Show API key");
  $("#toggle-key").setAttribute("aria-pressed", String(reveal));
});

async function initialize() {
  setBusy(true);
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    const stored = await chrome.storage.local.get(["apiKey", "threshold"]);
    keyInput.value = stored.apiKey || "";
    threshold.value = String(Math.round(normalizeThreshold(stored.threshold) * 100));
    syncThreshold();
    setSaved(Boolean(stored.apiKey));
  } catch { setStatus("Could not load settings. Please reload the extension.", "error"); }
  finally { setBusy(false); }
}

$("#settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  operation++;
  try {
    const apiKey = validateKey(keyInput.value);
    setBusy(true);
    await chrome.storage.local.set({ apiKey, threshold: normalizeThreshold(Number(threshold.value) / 100) });
    keyInput.value = apiKey;
    setSaved(true);
    setStatus("Saved. Open a webpage and click Senseek to search.", "success");
  } catch (error) { setStatus(error.message || "Could not save settings. Please try again.", "error"); }
  finally { setBusy(false); }
});

$("#verify").addEventListener("click", async () => {
  const current = ++operation;
  try {
    const key = validateKey(keyInput.value);
    setBusy(true);
    setStatus("Checking your key and JEV model access…");
    const response = await chrome.runtime.sendMessage({ type: "JEV_VERIFY_KEY", key });
    if (current !== operation) return;
    if (!response?.ok) throw new Error(response?.error || "Could not verify your key. Please try again.");
    setStatus("Verified. Your account can access JEV. Click “Save settings” to save this key.", "success");
  } catch (error) { if (current === operation) setStatus(error.message, "error"); }
  finally { if (current === operation) setBusy(false); }
});

$("#remove-key").addEventListener("click", async () => {
  operation++;
  setBusy(true);
  try {
    await chrome.storage.local.remove("apiKey");
    keyInput.value = "";
    keyInput.type = "password";
    $("#toggle-key").setAttribute("aria-label", "Show API key");
    $("#toggle-key").setAttribute("aria-pressed", "false");
    setSaved(false);
    setStatus("Saved key removed. Add a key to start searching again.");
  } catch { setStatus("Could not remove the key. Please try again.", "error"); }
  finally { setBusy(false); }
});

if (/Mac/i.test(navigator.platform)) $("#shortcut").textContent = "⌘ ⇧ F";
$("#notice").hidden = new URLSearchParams(location.search).get("notice") !== "unsupported";
initialize();
