import { collectPage, rangeFor, revealRange } from "./page.js";
import { mountPanel, searchBar, svg, matchesIcon } from "./search-bar.js";
import { localize, normalizeLanguage, setMessage } from "../extension/core/i18n.js";

(() => {
  const old = document.querySelector("[data-jev-find-root]");
  if (old && !old.hasAttribute("data-jev-closing")) {
    old.dispatchEvent(new Event("jev-find-close"));
    return;
  }
  // A new toolbar action can reopen while the previous panel is sliding out.
  old?.remove();

  const beforeFocus = document.activeElement;
  const host = document.createElement("div");
  host.dataset.jevFindRoot = "";
  host.lang = "en";
  host.style.setProperty("all", "initial", "important");
  for (const [name, value] of Object.entries({
    display: "block",
    position: "fixed",
    top: "8px",
    right: "14px",
    "z-index": "2147483647",
  })) host.style.setProperty(name, value, "important");

  const settingsIcon = svg('<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3 3-1 3 1 1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3-3 1Z"/><circle cx="12" cy="12" r="3"/>');

  // This markup is extension-owned. Text from the page and from JEV is only
  // inserted with textContent below.
  const shadow = mountPanel(host, `${searchBar()}
    <section class="expanded" aria-label="Semantic matches" data-i18n-aria-label="search.region" aria-hidden="true" inert>
      <div class="expanded-content">
        <p class="status sr-only" role="status" aria-live="polite" data-i18n="search.ready">Ready to search</p>
        <div class="empty"><h2 data-i18n="app.headline">Find what you mean.</h2><p class="hint" data-i18n="search.hint">Ask a question or describe an idea to find the relevant text on this page.</p><div class="examples"><button type="button" data-i18n="search.exampleFees">Any extra fees?</button><button type="button" data-i18n="search.exampleCancel">How do I cancel?</button></div><button class="setup" type="button" data-i18n="search.addKey" hidden>Add API key</button></div>
        <div class="loading" role="status" data-i18n="search.loading" hidden>Searching this page…</div>
        <div class="results" aria-label="Search results" data-i18n-aria-label="search.results" hidden></div>
        <p class="page-note" hidden></p>
        <footer><span><span data-i18n="search.poweredBy">Powered by</span> <strong>JEV</strong></span><span class="key-hints"><span><kbd>Enter</kbd> <span data-i18n="search.nextHint">Next</span></span><span><kbd>Shift+Enter</kbd> <span data-i18n="search.previousHint">Previous</span></span></span><button class="icon settings" type="button" aria-label="Open settings" data-i18n-aria-label="search.openSettings" title="Settings" data-i18n-title="search.settings">${settingsIcon}</button></footer>
      </div>
    </section>`);
  document.documentElement.append(host);

  const $ = (selector) => shadow.querySelector(selector);
  const panel = $(".panel");
  const expandedPanel = $(".expanded");
  const input = $("input");
  const results = $(".results");
  const status = $(".status");
  const count = $(".count");
  let snapshot = collectPage();
  let matches = [];
  let active = 0;
  let busy = false;
  let closed = false;
  let expanded = false;
  let requestId = null;
  let generation = 0;
  let searchedQuery = "";
  let highlightSheet = null;
  let suppressEscapeKeyup = false;
  let language = "en";
  const text = (element, key, params = {}) => setMessage(element, key, params, language);

  function applyLanguage(value) {
    language = normalizeLanguage(value);
    host.lang = language;
    localize(shadow, language);
  }
  function languageChanged(message, sender) {
    if (sender.id === chrome.runtime.id && message?.type === "JEV_LANGUAGE" && !closed) applyLanguage(message.language);
  }
  chrome.runtime.onMessage.addListener(languageChanged);

  function compactStatus(key, error = false) {
    if (busy) {
      count.innerHTML = '<span class="search-spinner" aria-hidden="true"></span><span class="sr-only" data-i18n="search.searching"></span>';
      localize(count, language);
    }
    else if (matches.length) count.textContent = `${active + 1} / ${matches.length}`;
    else if (error) count.textContent = "!";
    else if (key === "search.noMatches") count.textContent = "0/0";
    else count.textContent = "";
  }
  function setStatus(key, error = false, params = {}) {
    text(status, key, params);
    status.classList.toggle("error", error);
    status.classList.toggle("sr-only", !error);
    compactStatus(key, error);
  }
  function setExpanded(value) {
    expanded = Boolean(value);
    if (!expanded && expandedPanel.contains(shadow.activeElement)) $(".expand").focus({ preventScroll: true });
    expandedPanel.inert = !expanded;
    expandedPanel.setAttribute("aria-hidden", String(!expanded));
    panel.classList.toggle("is-expanded", expanded);
    $(".expand").setAttribute("aria-expanded", String(expanded));
    $(".expand").setAttribute("data-i18n-aria-label", expanded ? "search.hideMatches" : "search.showMatches");
    $(".expand").setAttribute("data-i18n-title", expanded ? "search.hideMatches" : "search.showMatches");
    localize(shadow, language);
    $(".expand").innerHTML = expanded ? svg('<path d="M4 6h10M4 11h10M4 16h7"/><path d="m16 18 3-3 3 3"/>') : matchesIcon;
  }
  function setBusy(value) {
    busy = value;
    panel.setAttribute("aria-busy", String(value));
    $(".loading").hidden = !value;
    $(".prev").disabled = value || matches.length < 2;
    $(".next").disabled = value || matches.length < 2;
    compactStatus(status.dataset.i18n, status.classList.contains("error"));
  }
  function setPageNotice() {
    $(".page-note").hidden = !snapshot.truncated;
    text($(".page-note"), snapshot.truncated ? "search.partial" : "");
  }
  function empty(mode = "default") {
    const [title, hint] = mode === "setup" ? ["search.connectKey", "search.connectHint"]
      : mode === "noMatches" ? ["search.tryAgain", "search.tryHint"] : ["app.headline", "search.hint"];
    const emptyView = $(".empty");
    emptyView.hidden = false;
    text($(".empty h2"), title);
    text($(".hint"), hint);
    $(".examples").hidden = mode !== "default" || !snapshot.blocks.length;
    $(".setup").hidden = mode !== "setup";
  }
  function message(data) {
    try { return chrome.runtime.sendMessage(data); }
    catch { return Promise.reject(Object.assign(new Error(), { messageKey: "error.extensionUpdated" })); }
  }
  const openSettings = () => message({ type: "JEV_OPEN_SETTINGS" }).catch(() => setStatus("error.extensionUpdated", true));
  function clearHighlights() {
    if (globalThis.CSS?.highlights) for (const name of ["jev-find-focus", "jev-find-active"]) CSS.highlights.delete(name);
    if (highlightSheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== highlightSheet);
    highlightSheet = null;
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
    active = 0;
    searchedQuery = "";
    results.replaceChildren();
    results.hidden = true;
    $(".prev").disabled = $(".next").disabled = true;
    clearHighlights();
    compactStatus(status.dataset.i18n, status.classList.contains("error"));
  }
  function paint(scroll = true) {
    clearHighlights();
    const focuses = [];
    let currentRange = null;
    for (let index = 0; index < matches.length; index++) {
      const block = snapshot.blocks.find((candidate) => candidate.id === matches[index].id);
      if (!block) continue;
      const focus = rangeFor(block, matches[index].focus);
      if (focus) focuses.push(focus);
      if (index === active) currentRange = focus;
    }
    if (matches.length && !currentRange) {
      setStatus("search.changed", true);
      return;
    }
    if (currentRange && scroll) revealRange(currentRange);
    if (globalThis.CSS?.highlights && globalThis.Highlight && currentRange) {
      highlightSheet = new CSSStyleSheet();
      highlightSheet.replaceSync("::highlight(jev-find-focus){background:#d2e7a8;color:#253d20}::highlight(jev-find-active){background:#ffb347;color:#3a2200}");
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightSheet];
      const focus = new Highlight(...focuses), selected = new Highlight(currentRange);
      focus.priority = 0; selected.priority = 1;
      CSS.highlights.set("jev-find-focus", focus);
      CSS.highlights.set("jev-find-active", selected);
    }
    [...results.children].forEach((button, index) => button.setAttribute("aria-current", String(index === active)));
    if (currentRange && scroll) {
      currentRange.startContainer.parentElement.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center", inline: "nearest" });
      const itemRect = results.children[active]?.getBoundingClientRect();
      const listRect = results.getBoundingClientRect();
      if (itemRect?.top < listRect.top) results.scrollTop += itemRect.top - listRect.top;
      else if (itemRect?.bottom > listRect.bottom) results.scrollTop += itemRect.bottom - listRect.bottom;
    }
  }
  function move(delta) {
    if (!matches.length) return;
    active = (active + delta + matches.length) % matches.length;
    setStatus(matches.length === 1 ? "search.countOne" : "search.countMany", false, { current: active + 1, total: matches.length });
    paint();
  }
  function showResults(elapsedMs) {
    $(".empty").hidden = matches.length > 0;
    results.hidden = matches.length === 0;
    $(".prev").disabled = $(".next").disabled = matches.length < 2;
    if (!matches.length) {
      empty("noMatches");
      setStatus("search.noMatches");
      return;
    }
    setStatus(matches.length === 1 ? "search.foundOne" : "search.foundMany", false, { total: matches.length, seconds: (elapsedMs / 1000).toFixed(1) });
    matches.forEach((match, index) => {
      const button = document.createElement("button");
      button.className = "result";
      button.type = "button";
      const top = document.createElement("div"); top.className = "result-top";
      const number = document.createElement("strong"); text(number, "search.match", { number: String(index + 1).padStart(2, "0") });
      const score = document.createElement("span"); text(score, "search.score", { percent: Math.round(match.probability * 100) });
      const excerpt = document.createElement("p"); excerpt.className = "excerpt"; excerpt.textContent = match.focus.text;
      top.append(number, score); button.append(top, excerpt);
      button.addEventListener("click", (event) => { event.stopPropagation(); active = index; move(0); });
      results.append(button);
    });
    paint();
  }
  async function search() {
    cancel();
    clearResults();
    const query = input.value.trim();
    if (!query) { setStatus("search.describe"); input.focus(); return; }
    snapshot = collectPage();
    if (document.body) observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    setPageNotice();
    if (!snapshot.blocks.length) { setExpanded(true); setStatus("search.noText", true); return; }
    const current = ++generation;
    requestId = crypto.randomUUID();
    setBusy(true);
    $(".empty").hidden = true;
    setStatus("search.finding");
    try {
      const result = await message({ type: "JEV_SEARCH", requestId, payload: { query, blocks: snapshot.blocks.map(({ id, text }) => ({ id, text })) } });
      if (closed || current !== generation) return;
      if (!result || result.error) {
        if (["KEY_MISSING", "KEY_INVALID"].includes(result?.code)) {
          setExpanded(true);
          empty("setup");
        }
        throw Object.assign(new Error(), { messageKey: result?.messageKey || "error.searchFailed", params: result?.params });
      }
      if (!Array.isArray(result.matches)) throw Object.assign(new Error(), { messageKey: "error.searchIncomplete" });
      matches = result.matches.filter((match) => snapshot.blocks.some((block) => block.id === match.id));
      active = 0;
      searchedQuery = query;
      showResults(result.elapsedMs);
    } catch (error) {
      if (!closed && current === generation) {
        setExpanded(true);
        setStatus(error.message.includes("Extension context") ? "error.extensionUpdated" : error.messageKey || "error.searchFailed", true, error.params);
        $(".empty").hidden = false;
      }
    } finally {
      if (!closed && current === generation) { requestId = null; setBusy(false); }
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    chrome.runtime.onMessage.removeListener(languageChanged);
    host.dataset.jevClosing = "";
    const style = getComputedStyle(panel);
    const start = { transform: style.transform, opacity: style.opacity };
    // Preserve the current size and position, including an unfinished opening.
    panel.style.height = `${panel.getBoundingClientRect().height}px`;
    cancel();
    clearHighlights();
    document.removeEventListener("keydown", keydown, true);
    if (!suppressEscapeKeyup) document.removeEventListener("keyup", keyup, true);
    if (beforeFocus?.isConnected) beforeFocus.focus({ preventScroll: true });
    host.inert = true;
    panel.setAttribute("aria-hidden", "true");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      host.remove();
      return;
    }
    for (const animation of panel.getAnimations()) animation.cancel();
    const exit = panel.animate([
      start,
      { transform: "translateY(calc(-100% - 8px))", opacity: 0 },
    ], { duration: 180, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
    exit.finished.then(() => host.remove(), () => host.remove());
  }
  function keydown(event) {
    const inside = event.composedPath().includes(host);
    if (inside) return;
    if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); suppressEscapeKeyup = true; close(); }
  }
  function keyup(event) {
    if (!suppressEscapeKeyup || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressEscapeKeyup = false;
    document.removeEventListener("keyup", keyup, true);
  }
  const observer = new MutationObserver((records) => {
    for (const block of snapshot.blocks) {
      if (!block.el.isConnected || records.some((record) => block.el.contains(record.target))) block.stale = true;
    }
    if (matches.some((match) => snapshot.blocks.find((block) => block.id === match.id)?.stale)) {
      clearHighlights();
      matches = [];
      results.replaceChildren();
      results.hidden = true;
      setStatus("search.changed", true);
    }
  });

  // Stop events after the control has handled them so page-level shortcuts do
  // not see input, navigation, or button events from the shadow tree.
  for (const type of ["keydown", "keyup", "keypress", "click", "mousedown", "mouseup", "input", "focusin"]) {
    host.addEventListener(type, (event) => {
      event.stopPropagation();
      if (type === "keydown" && event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        suppressEscapeKeyup = true;
        close();
      }
    });
  }
  $(".search").addEventListener("submit", (event) => { event.preventDefault(); if (!busy) void search(); });
  input.addEventListener("input", () => { cancel(); clearResults(); empty(); setStatus("search.enter"); });
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape" && !event.isComposing) {
      event.preventDefault();
      suppressEscapeKeyup = true;
      close();
      return;
    }
    if (event.isComposing || event.keyCode === 229) { if (event.key === "Enter") event.preventDefault(); return; }
    if (event.key === "Enter") {
      event.preventDefault();
      if (busy) return;
      if (matches.length && input.value.trim() === searchedQuery) move(event.shiftKey ? -1 : 1);
      else void search();
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && matches.length) {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    }
  });
  $(".prev").onclick = () => move(-1);
  $(".next").onclick = () => move(1);
  $(".expand").onclick = () => setExpanded(!expanded);
  $(".close").onclick = close;
  $(".settings").onclick = openSettings;
  $(".setup").onclick = openSettings;
  shadow.querySelectorAll(".examples button").forEach((button) => {
    button.onclick = () => { input.value = button.textContent; input.focus(); setStatus("search.enter"); };
  });
  host.addEventListener("jev-find-close", close);
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("keyup", keyup, true);
  setPageNotice();
  input.focus();

  const initialGeneration = generation;
  message({ type: "JEV_STATUS" }).then((data) => {
    if (closed) return;
    applyLanguage(data?.language);
    if (generation !== initialGeneration) return;
    if (!data?.configured) {
      setExpanded(true);
      empty("setup");
      $(".examples").hidden = true;
      $(".setup").hidden = false;
      setStatus("search.keyNeeded");
    } else {
      empty();
      setStatus("search.ready");
    }
  }).catch(() => { if (!closed) setStatus("error.extensionUpdated", true); });
})();
