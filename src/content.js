import { collectPage, rangeFor } from "./page.js";
import panelCss from "./content.css";
import brandIcon from "../extension/icons/mark.svg";

(() => {
  const old = document.querySelector("[data-jev-find-root]");
  if (old) { old.dispatchEvent(new Event("jev-find-close")); return; }
  const beforeFocus = document.activeElement;
  const host = document.createElement("div");
  host.dataset.jevFindRoot = "";
  host.lang = "en";
  host.style.setProperty("all", "initial", "important");
  for (const [name, value] of Object.entries({ display: "block", position: "fixed", top: "16px", right: "16px", "z-index": "2147483647" })) host.style.setProperty(name, value, "important");
  const shadow = host.attachShadow({ mode: "open" });
  const style = new CSSStyleSheet();
  style.replaceSync(panelCss);
  shadow.adoptedStyleSheets = [style];
  const svg = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const searchIcon = svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>');
  const arrowIcon = svg('<path d="M6 18 18 6M6 6h12v12"/>');
  // Only static, extension-owned markup enters innerHTML. Page/API text uses textContent.
  shadow.innerHTML = `<section class="panel" role="dialog" aria-label="Senseek page search">
    <div class="top"><div class="mark" aria-hidden="true">${brandIcon}</div><div class="brand">Senseek<span>Semantic Page Search</span></div>
      <button class="icon settings" aria-label="Open settings" title="Settings">${svg('<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3 3-1 3 1 1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3-3 1Z"/><circle cx="12" cy="12" r="3"/>')}</button>
      <button class="icon close" aria-label="Close search" title="Close · Esc">${svg('<path d="m6 6 12 12M18 6 6 18"/>')}</button></div>
    <form class="search"><div class="input-wrap">${searchIcon}<input maxlength="400" aria-label="Search this page" placeholder="Find what you mean…" autocomplete="off" spellcheck="false"><button class="submit" aria-label="Start search" title="Search · Enter">${arrowIcon}</button></div><p class="meta"></p></form>
    <div class="status-row"><span class="status" role="status" aria-live="polite">Ready to search</span><div class="nav"><button class="prev" aria-label="Previous match" disabled>↑</button><button class="next" aria-label="Next match" disabled>↓</button></div></div>
    <div class="empty"><div class="orbit">${svg('<path d="M12 3v4m0 10v4M3 12h4m10 0h4"/><circle cx="12" cy="12" r="5"/>')}</div><h2>Find what you mean.</h2><p class="hint">Ask a question or describe an idea.<br>Find the relevant words, right on the page.</p><div class="examples"><button type="button">Any extra fees?</button><button type="button">How do I cancel?</button></div><button class="setup" type="button" hidden>Add API key →</button></div>
    <div class="loading" role="status" hidden>Reading between the lines…</div><div class="results" aria-label="Search results" hidden></div>
    <div class="footer"><span>POWERED BY <strong>JEV</strong></span><span><kbd>Enter</kbd> Find / next <kbd>Esc</kbd> Close</span></div>
  </section>`;
  document.documentElement.append(host);
  const $ = (selector) => shadow.querySelector(selector);
  const input = $("input"), status = $(".status"), results = $(".results");
  let snapshot = collectPage(), matches = [], active = 0, busy = false, closed = false;
  let requestId = null, generation = 0, searchedQuery = "";
  let highlightSheet = null;
  const observer = new MutationObserver((records) => {
    for (const block of snapshot.blocks) {
      if (!block.el.isConnected || records.some((record) => block.el.contains(record.target))) block.stale = true;
    }
    if (matches.some((match) => snapshot.blocks.find((block) => block.id === match.id)?.stale)) {
      clearHighlights();
      setStatus("The page has changed. Please search again.", true);
    }
  });
  function message(data) {
    try { return chrome.runtime.sendMessage(data); }
    catch { return Promise.reject(new Error("The extension was updated. Refresh the page and try again.")); }
  }
  const openSettings = () => message({ type: "JEV_OPEN_SETTINGS" }).catch(() => setStatus("The extension was updated. Please refresh the page.", true));
  function setStatus(text, error = false) { status.textContent = text; status.classList.toggle("error", error); }
  function setMeta() { $(".meta").textContent = `${snapshot.blocks.length} passage${snapshot.blocks.length === 1 ? "" : "s"}${snapshot.truncated ? " · Partial page" : ""} · Sends text to JEV on search`; }
  function clearHighlights() {
    if (globalThis.CSS?.highlights) for (const name of ["jev-find-context", "jev-find-focus", "jev-find-active"]) CSS.highlights.delete(name);
    if (highlightSheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== highlightSheet);
    highlightSheet = null;
  }
  function setBusy(value) {
    busy = value;
    $(".loading").hidden = !value;
    $(".submit").dataset.busy = String(value);
    $(".submit").innerHTML = value ? svg('<rect x="4" y="4" width="16" height="16" rx="2"/>') : arrowIcon;
    $(".submit").setAttribute("aria-label", value ? "Cancel search" : "Start search");
    $(".submit").title = value ? "Cancel search" : "Search · Enter";
    $(".panel").setAttribute("aria-busy", String(value));
  }
  function cancel() {
    observer.disconnect();
    generation++;
    if (requestId) message({ type: "JEV_CANCEL", requestId }).catch(() => {});
    requestId = null;
    setBusy(false);
  }
  function clearResults() {
    matches = [];
    searchedQuery = "";
    results.replaceChildren();
    results.hidden = true;
    $(".prev").disabled = $(".next").disabled = true;
    clearHighlights();
  }
  function paint(scroll = true) {
    clearHighlights();
    const contexts = [], focuses = [];
    let currentRange = null;
    for (let i = 0; i < matches.length; i++) {
      const block = snapshot.blocks.find((b) => b.id === matches[i].id);
      if (!block) continue;
      const context = rangeFor(block), focus = rangeFor(block, matches[i].focus);
      if (context) contexts.push(context);
      if (focus) focuses.push(focus);
      if (i === active) currentRange = focus;
    }
    if (globalThis.CSS?.highlights && globalThis.Highlight) {
      highlightSheet = new CSSStyleSheet();
      highlightSheet.replaceSync("::highlight(jev-find-context){background:#eaf1db;color:#32472a}::highlight(jev-find-focus){background:#d2e7a8;color:#253d20}::highlight(jev-find-active){background:#bddd79;color:#1d3218}");
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightSheet];
      const context = new Highlight(...contexts), focus = new Highlight(...focuses), selected = new Highlight(...(currentRange ? [currentRange] : []));
      context.priority = 0; focus.priority = 1; selected.priority = 2;
      CSS.highlights.set("jev-find-context", context); CSS.highlights.set("jev-find-focus", focus); CSS.highlights.set("jev-find-active", selected);
    }
    [...results.children].forEach((button, index) => button.setAttribute("aria-current", String(index === active)));
    if (currentRange && scroll) {
      const target = currentRange.startContainer.parentElement;
      target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
      // Scroll only the results container; scrollIntoView here can cancel page navigation.
      const itemRect = results.children[active]?.getBoundingClientRect();
      const listRect = results.getBoundingClientRect();
      if (itemRect?.top < listRect.top) results.scrollTop += itemRect.top - listRect.top;
      else if (itemRect?.bottom > listRect.bottom) results.scrollTop += itemRect.bottom - listRect.bottom;
    }
    if (!currentRange && matches.length) setStatus("The page has changed. Please search again.", true);
  }
  function move(delta) {
    if (!matches.length) return;
    active = (active + delta + matches.length) % matches.length;
    setStatus(`${active + 1} / ${matches.length} ${matches.length === 1 ? "match" : "matches"}`);
    paint();
  }
  function showResults(elapsedMs) {
    $(".empty").hidden = matches.length > 0;
    results.hidden = matches.length === 0;
    $(".prev").disabled = $(".next").disabled = matches.length < 2;
    if (!matches.length) {
      setStatus("No strong matches found");
      $(".empty h2").textContent = "Try another way to ask.";
      $(".hint").textContent = "Describe a specific question, condition, or detail.";
      return;
    }
    setStatus(`1 / ${matches.length} ${matches.length === 1 ? "match" : "matches"} · ${(elapsedMs / 1000).toFixed(1)} s`);
    matches.forEach((match, index) => {
      const button = document.createElement("button");
      button.className = "result";
      button.type = "button";
      const top = document.createElement("div"); top.className = "result-top";
      const number = document.createElement("strong"); number.textContent = `${String(index + 1).padStart(2, "0")} / SOURCE PASSAGE`;
      const score = document.createElement("span"); score.textContent = `${Math.round(match.probability * 100)}% relevance`;
      const excerpt = document.createElement("p"); excerpt.className = "excerpt"; excerpt.textContent = match.focus.text;
      top.append(number, score); button.append(top, excerpt);
      button.addEventListener("click", () => { active = index; move(0); });
      results.append(button);
    });
    paint();
  }
  async function search() {
    cancel();
    clearResults();
    const query = input.value.trim();
    if (!query) { setStatus("Describe what you want to find."); input.focus(); return; }
    snapshot = collectPage();
    if (document.body) observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    setMeta();
    if (!snapshot.blocks.length) { setStatus("No readable text on this page.", true); return; }
    const current = ++generation;
    requestId = crypto.randomUUID();
    setBusy(true);
    $(".empty").hidden = true;
    $(".setup").hidden = true;
    setStatus("Finding relevant passages…");
    try {
      const result = await message({ type: "JEV_SEARCH", requestId, payload: { query, blocks: snapshot.blocks.map(({ id, text }) => ({ id, text })) } });
      if (closed || current !== generation) return;
      if (!result || result.error) {
        if (["KEY_MISSING", "KEY_INVALID"].includes(result?.code)) $(".setup").hidden = false;
        throw new Error(result?.error || "Search could not finish. Refresh the page and try again.");
      }
      if (!Array.isArray(result.matches)) throw new Error("Search results are incomplete. Please try again.");
      matches = result.matches.filter((m) => snapshot.blocks.some((b) => b.id === m.id));
      active = 0;
      searchedQuery = query;
      showResults(result.elapsedMs);
    } catch (error) {
      if (!closed && current === generation) {
        setStatus(error.message.includes("Extension context") ? "The extension was updated. Refresh the page and try again." : error.message, true);
        $(".empty").hidden = false;
      }
    } finally {
      if (!closed && current === generation) { requestId = null; setBusy(false); }
    }
  }
  function close() {
    closed = true; cancel(); clearHighlights(); host.remove();
    document.removeEventListener("keydown", keydown, true);
    if (beforeFocus?.isConnected) beforeFocus.focus({ preventScroll: true });
  }
  function keydown(event) {
    if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close(); }
  }
  $(".search").addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) { cancel(); setStatus("Search canceled"); $(".empty").hidden = false; }
    else search();
  });
  input.addEventListener("input", () => { cancel(); clearResults(); $(".empty").hidden = false; setStatus("Press Enter to search"); });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing && event.key === "Enter") { event.preventDefault(); return; }
    if (event.key === "Enter" && matches.length && input.value.trim() === searchedQuery) { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
  });
  $(".prev").onclick = () => move(-1); $(".next").onclick = () => move(1);
  $(".close").onclick = close; $(".settings").onclick = $(".setup").onclick = openSettings;
  shadow.querySelectorAll(".examples button").forEach((button) => { button.onclick = () => { input.value = button.textContent; input.focus(); setStatus("Press Enter to search"); }; });
  host.addEventListener("jev-find-close", close);
  document.addEventListener("keydown", keydown, true);
  setMeta(); input.focus();
  const initialGeneration = generation;
  message({ type: "JEV_STATUS" }).then((data) => {
    if (closed || generation !== initialGeneration) return;
    if (!data?.configured) {
      setStatus("One more step: set up Senseek");
      $(".empty h2").textContent = "Connect, then start exploring.";
      $(".hint").textContent = "Add your TypeSafe API key in the extension settings.";
      $(".examples").hidden = true;
      $(".setup").hidden = false;
    } else setStatus("This page · Search by meaning");
  }).catch(() => setStatus("The extension was updated. Refresh the page and try again.", true));
})();
