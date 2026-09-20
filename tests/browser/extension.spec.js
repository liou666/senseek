import { test, expect, chromium } from "@playwright/test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { attachActionPopup } from "./action-popup.js";

let context, worker, extensionId, server, baseUrl, requests, behavior, pageErrors;
const testKey = "TEST_ONLY_NOT_A_REAL_KEY";
const directory = path.resolve("test-results", `extension-fixture-${Date.now()}`);

test.beforeAll(async () => {
  await mkdir(directory, { recursive: true });
  await cp(path.resolve("extension"), path.join(directory, "extension"), { recursive: true });
  const manifestPath = path.join(directory, "extension", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Test-only host grant lets Playwright inject without a physical toolbar click.
  // The shipped manifest is separately checked to grant only api.typesafe.ai.
  manifest.host_permissions.push("http://127.0.0.1/*");
  await writeFile(manifestPath, JSON.stringify(manifest));
  // Expose the actual toolbar handler only in the isolated test extension.
  const backgroundPath = path.join(directory, "extension", manifest.background.service_worker);
  await writeFile(backgroundPath, `${await readFile(backgroundPath, "utf8")}\nglobalThis.testToggleSearch = toggleSearch;\n`);
  const article = await readFile("tests/fixtures/article.html");
  server = createServer((_request, response) => { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(article); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const extension = path.join(directory, "extension");
  context = await chromium.launchPersistentContext(path.join(directory, "profile"), {
    channel: "chromium", headless: true, viewport: { width: 1440, height: 1050 }, reducedMotion: "reduce",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
  await context.route("https://api.typesafe.ai/**", async (route) => {
    const request = route.request();
    requests.push({ url: request.url(), method: request.method(), body: request.postDataJSON() });
    expect(request.headers().authorization).toBe(`Bearer ${testKey}`);
    if (behavior === "unauthorized") return route.fulfill({ status: 401, json: { detail: "UNTRUSTED_ERROR_BODY" } });
    if (behavior === "network") return route.abort();
    if (request.url().endsWith("/models")) return route.fulfill({ json: { models: [{ name: "jev-latest" }] } });
    if (behavior === "slow") await new Promise((r) => setTimeout(r, 1500));
    const payload = request.postDataJSON();
    const answers = {};
    for (const block of payload.state.passages) {
      // Fixed model replies exercise label extraction and highlighting independently of API quality.
      const label = behavior === "labels" ? { "文档": "Docs", "价格": "Pricing", "帮助": "Help", "隐私": "Privacy" }[payload.state.search] : null;
      answers[block.id] = { type: "noul", noul: behavior === "labels" ? (block.text === label ? 0.99 : 0.1) : behavior === "none" ? 0.1 : block.text.includes("After canceling, you keep access") ? 0.96 : block.text.includes("Canceling your subscription does not") ? 0.82 : 0.1 };
      const question = payload.questions[`focus_${block.id}`];
      if (question) answers[`focus_${block.id}`] = { type: "choice", choice: Object.entries(question.criteria).find(([, text]) => text.includes("After canceling, you keep access"))?.[0] || Object.keys(question.criteria)[0] };
    }
    await route.fulfill({ json: { model: "jev-1.13.0", answers } }).catch(() => {});
  });
});

test.beforeEach(async () => {
  requests = []; behavior = "normal"; pageErrors = [];
  await worker.evaluate(() => chrome.storage.local.clear());
  for (const page of context.pages()) await page.close();
});

test.afterAll(async () => { await context?.close(); await new Promise((resolve) => server?.close(resolve)); });

async function options() {
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator("#api-key")).toBeEnabled();
  await expect(page.locator(".header")).toHaveCount(0);
  await expect(page.locator(".hero-brand")).toContainText("Senseek");
  return page;
}
async function article(configured = true) {
  if (configured) await worker.evaluate((apiKey) => chrome.storage.local.set({ apiKey }), testKey);
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(baseUrl);
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}/*` });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  }, baseUrl);
  await expect(page.locator(".panel")).toBeVisible();
  return page;
}
async function query(page, text = "Can I still use it after canceling?") {
  const field = page.locator(".input-wrap input");
  await field.fill(text);
  await field.press("Enter");
}
async function reopen(page) {
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}/*` });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  }, baseUrl);
  await expect(page.locator(".panel")).toBeVisible();
}

test("settings save automatically, verify against models endpoint, and can be removed", async () => {
  const page = await options();
  await page.screenshot({ path: "test-results/settings-desktop.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
  await page.locator("#api-key").fill(`  ${testKey}  `);
  await expect.poll(() => worker.evaluate(() => chrome.storage.local.get("apiKey"))).toEqual({ apiKey: testKey });
  await expect(page.locator("#key-state")).toHaveText("Saved");
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Show API key" }).click();
  await expect(page.locator("#api-key")).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide API key" }).click();
  await page.getByRole("button", { name: "Verify key", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Verified.");
  expect(requests[0].url).toContain("/v1/models");
  expect(requests[0].body).toBe(null);
  await expect(page.locator("#status")).not.toContainText("Save settings");
  await page.reload();
  await expect(page.locator("#api-key")).toHaveValue(testKey);
  expect(await worker.evaluate(() => chrome.storage.local.get("apiKey"))).toEqual({ apiKey: testKey });
  await page.getByRole("button", { name: "Remove saved key" }).click();
  await expect(page.locator("#api-key")).toHaveValue("");
  await expect.poll(() => worker.evaluate(() => chrome.storage.local.get("apiKey"))).toEqual({});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/settings-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("language selection persists and updates settings, active results and errors without changing page text", async () => {
  const settings = await options();
  const page = await article();
  await query(page);
  await expect(page.locator(".count")).toHaveText("1 / 2");
  await page.locator(".expand").click();
  const excerpts = await page.locator(".excerpt").allTextContents();
  const requestCount = requests.length;
  await settings.locator("#language").selectOption("zh-CN");
  await expect(settings.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(settings).toHaveTitle("Senseek · 设置");
  await expect(settings.getByLabel("界面语言")).toHaveValue("zh-CN");
  await expect(page.locator("[data-jev-find-root]")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("textbox", { name: "搜索此页面" })).toHaveAttribute("placeholder", "语义搜索 · 回车");
  await expect(page.locator(".input-wrap input")).toHaveValue("Can I still use it after canceling?");
  await expect(page.locator(".result-top").first()).toContainText("匹配度 96%");
  await expect(page.getByRole("button", { name: "收起匹配结果" })).toBeVisible();
  expect(await page.locator(".excerpt").allTextContents()).toEqual(excerpts);
  expect(requests).toHaveLength(requestCount);
  expect(await page.evaluate(() => [...CSS.highlights.get("jev-find-active")].map((range) => range.toString()))).toEqual([excerpts[0]]);
  await page.screenshot({ path: "test-results/search-zh-CN.png" });
  await settings.reload();
  await expect(settings.locator("#language")).toHaveValue("zh-CN");
  await expect(settings.locator("#api-key")).toHaveValue(testKey);
  await settings.screenshot({ path: "test-results/settings-zh-CN.png" });
  await settings.locator(".advanced summary").click();
  await settings.locator("#threshold").press("End");
  await expect(settings.locator("#preference-status")).toHaveText("已保存。");
  await settings.locator("#reset-preferences").click();
  await expect(settings.locator("#preference-status")).toHaveText("已恢复默认值。");

  await settings.locator("#language").selectOption("ja");
  await expect(settings).toHaveTitle("Senseek · 設定");
  await expect(settings.getByLabel("表示言語")).toHaveValue("ja");
  await expect(page.locator(".result-top").first()).toContainText("一致度 96%");
  await expect(page.locator(".input-wrap input")).toHaveAttribute("placeholder", "意味で検索 · Enter");
  await expect(settings.locator("#preference-status")).toHaveText("既定値に戻しました。");
  await settings.locator(".advanced summary").click();
  await settings.screenshot({ path: "test-results/settings-ja.png" });
  await page.screenshot({ path: "test-results/search-ja.png" });
  await settings.setViewportSize({ width: 390, height: 844 });
  await settings.screenshot({ path: "test-results/settings-ja-mobile.png", fullPage: true });
  expect(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  behavior = "none";
  await query(page, "Where is the moon base?");
  await expect(page.locator(".count")).toHaveText("0/0");
  await expect(page.locator(".empty h2")).toHaveText("別の言い方で検索してみましょう。");
  await settings.locator("#language").selectOption("zh-CN");
  await expect(page.locator(".empty h2")).toHaveText("换一种方式搜索。");
  await expect(page.locator(".count")).toHaveText("0/0");
  await expect(page.locator(".setup")).toBeHidden();
  behavior = "unauthorized";
  await query(page);
  await expect(page.locator(".status")).toHaveText("API 密钥无效或已过期，请在设置中更新 TypeSafe/JEV 密钥。");
  await expect(page.getByRole("button", { name: "添加 API 密钥" })).toBeVisible();
  await settings.locator("#language").selectOption("ja");
  await expect(page.locator(".status")).toHaveText("API キーが無効か期限切れです。設定で TypeSafe/JEV のキーを更新してください。");
  await expect(page.getByRole("button", { name: "API キーを追加" })).toBeVisible();
  await settings.locator("#verify").click();
  await expect(settings.locator("#status")).toHaveText("API キーが無効か期限切れです。設定で TypeSafe/JEV のキーを更新してください。");
  await settings.locator("#api-key").fill("invalid key");
  await expect(settings.locator("#status")).toHaveText("API キーの形式が無効です。空白や改行がないか確認してください。");
  await expect(settings.locator("#key-state")).toHaveText("未保存");
  expect(await worker.evaluate(() => chrome.storage.local.get(["language", "apiKey", "threshold"]))).toEqual({ language: "ja", apiKey: testKey, threshold: 0.58 });
  expect(pageErrors).toEqual([]);
});

test("language changes during a search preserve the request and localize reopened panels and notices", async () => {
  const settings = await options();
  const otherSettings = await options();
  const page = await article();
  behavior = "slow";
  await query(page);
  await expect(page.locator(".panel")).toHaveAttribute("aria-busy", "true");
  await settings.locator("#language").selectOption("ja");
  await expect(page.locator(".count .sr-only")).toHaveText("検索中…");
  await expect(otherSettings.locator("#language")).toHaveValue("ja");
  await expect(page.locator(".count")).toHaveText("1 / 2");
  expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  await page.locator(".close").click();
  await reopen(page);
  await expect(page.getByRole("dialog", { name: "Senseek ページ内検索" })).toBeVisible();
  await page.locator(".expand").click();
  await expect(page.locator(".examples button").first()).toHaveText("追加料金はありますか？");
  await page.locator(".examples button").first().click();
  await expect(page.locator(".input-wrap input")).toHaveValue("追加料金はありますか？");

  const notice = await context.newPage();
  await notice.goto(`chrome-extension://${extensionId}/unavailable.html`);
  await expect(notice.locator(".unavailable-message")).toHaveText("このページには対応していません。");
  await settings.locator("#language").selectOption("zh-CN");
  await expect(notice.locator(".unavailable-message")).toHaveText("暂不支持此页面。");
  await expect(notice.getByRole("button", { name: "关闭搜索" })).toBeVisible();
  await expect(otherSettings).toHaveTitle("Senseek · 设置");
  await expect.poll(() => worker.evaluate(() => chrome.action.getTitle({}))).toBe("Senseek · 搜你所想");
  await worker.evaluate(() => chrome.storage.local.set({ language: "unsupported" }));
  await expect(page.locator(".input-wrap input")).toHaveAttribute("placeholder", "Search meaning · Enter");
  await expect(notice.locator(".unavailable-message")).toHaveText("This page is not supported.");
  await expect(settings.locator("#language")).toHaveValue("en");
  expect(pageErrors).toEqual([]);
});

test("search preferences save without a key and reset without changing credentials", async () => {
  const page = await options();
  await page.locator(".advanced summary").click();
  await expect(page.getByRole("button", { name: "Reset search preferences" })).toBeDisabled();
  await page.locator("#threshold").press("End");
  await expect(page.locator("#threshold-output")).toHaveText("90%");
  await expect.poll(() => worker.evaluate(() => chrome.storage.local.get(["apiKey", "threshold"]))).toEqual({ threshold: 0.9 });
  await page.reload();
  await expect(page.locator("#threshold")).toHaveValue("90");
  await page.locator("#api-key").fill(testKey);
  await expect(page.locator("#key-state")).toHaveText("Saved");
  await page.locator(".advanced summary").click();
  await page.locator("#threshold").press("Home");
  await page.getByRole("button", { name: "Reset search preferences" }).click();
  await expect(page.locator("#threshold-output")).toHaveText("58%");
  await expect(page.locator("#preference-status")).toHaveText("Reset to default.");
  await expect.poll(() => worker.evaluate(() => chrome.storage.local.get(["apiKey", "threshold"]))).toEqual({ apiKey: testKey, threshold: 0.58 });
  await page.reload();
  await expect(page.locator("#api-key")).toHaveValue(testKey);
  await expect(page.locator("#threshold")).toHaveValue("58");
  expect(requests).toHaveLength(0);
  expect(pageErrors).toEqual([]);
});

test("invalid key edits keep the saved key and rapid edits can be cleared", async () => {
  const page = await options();
  const input = page.locator("#api-key");
  await input.fill(testKey);
  await expect(page.locator("#key-state")).toHaveText("Saved");
  await input.fill("invalid key with spaces");
  await expect(page.locator("#key-state")).toHaveText("Not saved");
  await expect(page.locator("#status")).toContainText("Invalid API key format");
  expect(await worker.evaluate(() => chrome.storage.local.get("apiKey"))).toEqual({ apiKey: testKey });
  await expect(page.getByRole("button", { name: "Verify key", exact: true })).toBeDisabled();
  await input.fill("ANOTHER_TEST_ONLY_KEY");
  await input.clear();
  await expect(page.locator("#key-state")).toHaveText("Not configured");
  await expect.poll(() => worker.evaluate(() => chrome.storage.local.get("apiKey"))).toEqual({});
  await input.pressSequentially(testKey, { delay: 1 });
  await page.getByRole("button", { name: "Remove saved key" }).click();
  await expect(page.locator("#key-state")).toHaveText("Not configured");
  await page.reload();
  await expect(input).toHaveValue("");
  expect(await worker.evaluate(() => chrome.storage.local.get("apiKey"))).toEqual({});
  expect(requests).toHaveLength(0);
  expect(pageErrors).toEqual([]);
});

test("missing key has a setup path and never calls API; content cannot read saved credentials", async () => {
  const page = await article(false);
  await expect(page.getByRole("button", { name: "Add API key" })).toBeVisible();
  await query(page);
  await expect(page.locator(".status")).toContainText("Add your JEV API key in Settings");
  expect(requests).toHaveLength(0);
  await worker.evaluate((apiKey) => chrome.storage.local.set({ apiKey }), testKey);
  const readable = await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}/*` });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
      try { return await chrome.storage.local.get("apiKey"); } catch { return "ACCESS_DENIED"; }
    } });
    return result.result;
  }, baseUrl);
  expect(readable).toBe("ACCESS_DENIED");
  expect(await page.locator("[data-jev-find-root]").evaluate((el) => el.shadowRoot.innerHTML)).not.toContain(testKey);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("semantic search extracts visible text, highlights across inline tags, and navigates original passages", async () => {
  const page = await article();
  await page.screenshot({ path: "test-results/search-empty.png", fullPage: false });
  await query(page);
  await expect(page.locator(".result")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Show ranked matches" })).toBeVisible();
  await page.getByRole("button", { name: "Show ranked matches" }).click();
  await expect(page.getByRole("region", { name: "Semantic matches" })).toBeVisible();
  const sent = JSON.stringify(requests.filter((r) => r.body).map((r) => r.body));
  for (const secret of ["HIDDEN_SECRET", "INPUT_SECRET", "TEXTAREA_SECRET", "EDITABLE_SECRET", "ARIA_SECRET"]) expect(sent).not.toContain(secret);
  expect(sent).toContain("Visible navigation");
  expect(sent).toContain("Team admins can");
  expect(sent).not.toContain(testKey);
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  expect(await page.evaluate(() => CSS.highlights.has("jev-find-context"))).toBe(false);
  const highlighted = await page.evaluate(() => [...CSS.highlights.get("jev-find-active")].map((range) => range.toString()));
  expect(highlighted).toEqual(["After canceling, you keep access to all features until the current billing period ends."]);
  expect((await page.locator(".panel").boundingBox()).y).toBe(8);
  const target = await page.locator("#cancellation").boundingBox();
  expect(Math.abs(target.y + target.height / 2 - 525)).toBeLessThan(10);
  await page.screenshot({ path: "test-results/search-results.png", fullPage: false });
  await page.getByRole("button", { name: "Next match" }).click();
  await expect(page.locator(".count")).toHaveText("2 / 2");
  await page.getByRole("textbox", { name: "Search this page" }).focus();
  await page.keyboard.press("Shift+Enter");
  await expect(page.locator(".count")).toHaveText("1 / 2");
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  await page.evaluate(() => { document.querySelector("#cancellation").textContent = "The page content has changed."; });
  await expect(page.locator(".result")).toHaveCount(0);
  await expect(page.locator(".status")).toContainText("The page has changed");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("navigation, footer links and buttons are searchable as separate labels without splitting prose links", async () => {
  const page = await article();
  await page.evaluate(() => {
    document.querySelector("header").innerHTML = `<nav><a href="/desktop">Desktop</a><a id="docs-link" href="/docs"><span>Do</span><span>cs</span></a><a href="/cli">CLI</a><div hidden><a href="/hidden">HIDDEN_NAV_SECRET</a></div><a href="/hidden" aria-hidden="true">ARIA_NAV_SECRET</a><div style="display:none"><a href="/hidden"><span>CSS_NAV_SECRET</span></a></div></nav><div role="navigation"><a id="pricing-link" href="/pricing"><span>Pricing</span></a></div>`;
    document.querySelector("#cancellation strong").innerHTML = '<a href="/features">all features</a>';
    document.querySelector("main").insertAdjacentHTML("afterbegin", '<button id="help-button" type="button"><span>Help</span></button>');
    document.body.insertAdjacentHTML("beforeend", '<footer><a id="privacy-link" href="/privacy"><span>Privacy</span></a></footer>');
    window.controlClicks = 0;
    for (const control of document.querySelectorAll("a,button")) control.addEventListener("click", () => window.controlClicks++);
  });
  behavior = "labels";
  for (const [term, text, id] of [["文档", "Docs", "docs-link"], ["价格", "Pricing", "pricing-link"], ["帮助", "Help", "help-button"], ["隐私", "Privacy", "privacy-link"]]) {
    await query(page, term);
    await expect(page.locator(".count")).toHaveText("1 / 1");
    expect(await page.evaluate(() => [...CSS.highlights.get("jev-find-active")].map((range) => ({ text: range.toString(), id: range.startContainer.parentElement.closest("a,button").id })))).toEqual([{ text, id }]);
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
  const passages = requests.filter((request) => request.body?.state.search === "文档").flatMap((request) => request.body.state.passages.map((block) => block.text));
  expect(passages).toEqual(expect.arrayContaining(["Desktop", "Docs", "CLI", "Pricing", "Help", "Privacy"]));
  expect(passages.filter((text) => text.includes("After canceling"))).toEqual([
    "You can manage your subscription in account settings. After canceling, you keep access to all features until the current billing period ends. We do not prorate unused days.",
  ]);
  for (const secret of ["HIDDEN_NAV_SECRET", "ARIA_NAV_SECRET", "CSS_NAV_SECRET"]) expect(passages.join(" ")).not.toContain(secret);
  expect(await page.evaluate(() => window.controlClicks)).toBe(0);
  expect(page.url()).toBe(`${baseUrl}/`);
  expect(pageErrors).toEqual([]);
});

test("selecting a match reveals its nested disclosures and preserves exclusive accordion behavior", async () => {
  const page = await article();
  await page.evaluate(() => {
    const first = document.querySelector("#cancellation");
    const second = document.querySelector("#second");
    const faq = document.createElement("details");
    faq.id = "faq";
    faq.innerHTML = `<summary>Subscription FAQ</summary>
      <details id="access-faq" name="subscription-faq"><summary>Keeping access</summary></details>
      <details id="documents-faq" name="subscription-faq"><summary>Saved documents</summary></details>
      <details id="unrelated-faq"><summary>Other questions</summary><p>Contact support for account updates.</p></details>`;
    first.before(faq);
    faq.querySelector("#access-faq").append(first);
    faq.querySelector("#documents-faq").append(second);
    const hidden = document.createElement("p");
    hidden.hidden = true;
    hidden.textContent = "COLLAPSED_HIDDEN_SECRET";
    first.after(hidden);
    const spacer = document.createElement("div");
    spacer.style.height = "1100px";
    document.querySelector("main").replaceChildren(spacer, faq);
  });
  behavior = "slow";
  await query(page);
  await expect.poll(() => requests.filter((request) => request.body).length).toBe(1);
  for (const id of ["faq", "access-faq", "documents-faq", "unrelated-faq"]) {
    await expect(page.locator(`#${id}`)).toHaveJSProperty("open", false);
  }
  const sent = JSON.stringify(requests.filter((request) => request.body).map((request) => request.body));
  expect(sent).toContain("After canceling, you keep access");
  expect(sent).toContain("Canceling your subscription does not");
  expect(sent).not.toContain("COLLAPSED_HIDDEN_SECRET");

  await expect(page.locator(".count")).toHaveText("1 / 2");
  await expect(page.locator("#faq")).toHaveJSProperty("open", true);
  await expect(page.locator("#access-faq")).toHaveJSProperty("open", true);
  await expect(page.locator("#documents-faq")).toHaveJSProperty("open", false);
  await expect(page.locator("#unrelated-faq")).toHaveJSProperty("open", false);
  await expect(page.locator("#cancellation")).toBeInViewport();
  expect(await page.evaluate(() => [...CSS.highlights.get("jev-find-active")].map((range) => range.toString()))).toEqual([
    "After canceling, you keep access to all features until the current billing period ends.",
  ]);
  await page.screenshot({ path: "test-results/collapsed-match.png", fullPage: false });

  await page.getByRole("button", { name: "Next match" }).click();
  await expect(page.locator(".count")).toHaveText("2 / 2");
  await expect(page.locator("#documents-faq")).toHaveJSProperty("open", true);
  await expect(page.locator("#access-faq")).toHaveJSProperty("open", false);
  await expect(page.locator("#second")).toBeInViewport();

  await page.getByRole("textbox", { name: "Search this page" }).press("Shift+Enter");
  await expect(page.locator("#access-faq")).toHaveJSProperty("open", true);
  await expect(page.locator("#documents-faq")).toHaveJSProperty("open", false);
  await page.getByRole("button", { name: "Show ranked matches" }).click();
  await page.locator("#faq > summary").click();
  await expect(page.locator("#faq")).toHaveJSProperty("open", false);
  await page.locator(".result").first().click();
  await expect(page.locator("#faq")).toHaveJSProperty("open", true);
  await expect(page.locator("#cancellation")).toBeInViewport();
  await expect(page.locator(".status")).not.toContainText("The page has changed");
  await expect(page.locator("#unrelated-faq")).toHaveJSProperty("open", false);
  expect(requests.filter((request) => request.body)).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test("summary matches stay collapsed and direct disclosure text is revealed separately", async () => {
  const page = await article();
  await page.locator("main").evaluate((main) => {
    main.innerHTML = `<details id="outer-faq"><summary>Subscription FAQ</summary>
      <details id="summary-faq"><summary>After canceling, you keep access to all features until the current billing period ends.</summary>
        This answer does not match the query.
      </details>
      <details id="text-faq"><summary>Saved documents</summary>
        Canceling your subscription does not immediately delete your <strong>documents</strong>.
      </details>
    </details>`;
  });
  await query(page);
  await expect(page.locator(".count")).toHaveText("1 / 2");
  await expect(page.locator("#outer-faq")).toHaveJSProperty("open", true);
  await expect(page.locator("#summary-faq")).toHaveJSProperty("open", false);
  await expect(page.locator("#text-faq")).toHaveJSProperty("open", false);
  await page.getByRole("button", { name: "Next match" }).click();
  await expect(page.locator("#text-faq")).toHaveJSProperty("open", true);
  expect(await page.evaluate(() => [...CSS.highlights.get("jev-find-active")].map((range) => range.toString()))).toEqual([
    "Canceling your subscription does not immediately delete your documents.",
  ]);
  expect(pageErrors).toEqual([]);
});

test("cancelled searches cannot paint stale results; no-match and auth errors remain actionable", async () => {
  const page = await article();
  behavior = "slow";
  await query(page);
  await expect.poll(() => requests.length).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Senseek page search" })).toHaveCount(0);
  await page.waitForTimeout(1800);
  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
  await reopen(page);
  behavior = "none";
  await query(page, "Where is the moon base?");
  await page.getByRole("button", { name: "Show ranked matches" }).click();
  await expect(page.locator(".status")).toContainText("No strong matches found");
  behavior = "unauthorized";
  await query(page);
  await expect(page.locator(".status")).toContainText("Your API key is invalid");
  await expect(page.locator(".status")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add API key" })).toBeVisible();
  await expect(page.locator(".status")).not.toContainText("UNTRUSTED_ERROR_BODY");
  behavior = "network";
  await query(page);
  await expect(page.locator(".status")).toContainText("Could not connect to JEV");
  await expect(page.locator(".status")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("long div-based pages are split and extraction limits are visible", async () => {
  const page = await article();
  await page.evaluate(() => {
    const main = document.querySelector("main");
    main.replaceChildren();
    for (let i = 0; i < 200; i++) { const paragraph = document.createElement("div"); paragraph.textContent = `Paragraph ${i} ` + "This is a long page passage. ".repeat(90); main.append(paragraph); }
  });
  await query(page);
  await page.getByRole("button", { name: "Show ranked matches" }).click();
  await expect(page.locator(".page-note")).toHaveText("Search covers only part of this page.");
  await expect(page.locator(".page-note")).toBeVisible();
  await expect(page.locator(".status")).toContainText("No strong matches found");
  const captured = requests.filter((r) => r.body).flatMap((r) => r.body.state.passages);
  expect(captured.length).toBeLessThanOrEqual(160);
  expect(captured.reduce((n, b) => n + b.text.length, 0)).toBeLessThanOrEqual(60000);
  expect(new Set(captured.map((b) => b.id)).size).toBe(captured.length);
  expect(pageErrors).toEqual([]);
});

test("native-style bar stays compact, expands confidence results, and owns keyboard input", async () => {
  const page = await article();
  await page.evaluate(() => {
    window.pageKeys = [];
    for (const type of ["keydown", "keypress", "keyup"]) document.addEventListener(type, (event) => window.pageKeys.push(event.key));
  });
  const field = page.getByRole("textbox", { name: "Search this page" });
  const compact = await page.locator(".panel").boundingBox();
  expect(compact.width).toBeLessThan(440);
  await expect(page.locator(".count")).toHaveText("");
  await query(page);
  await expect(page.getByRole("button", { name: "Show ranked matches" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Show ranked matches" }).click();
  await expect(page.getByRole("region", { name: "Semantic matches" })).toBeVisible();
  await expect(page.locator(".result-top").first()).toContainText("96% match");
  await field.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.pageKeys)).toEqual([]);
  await expect(page.getByRole("dialog", { name: "Senseek page search" })).toHaveCount(0);
  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("unsupported pages show a compact toolbar notice without opening a tab and recover after navigation", async () => {
  const page = await context.newPage();
  await page.goto("chrome://version/");
  await page.bringToFront();
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  const before = await worker.evaluate(async () => (await chrome.tabs.query({})).map((tab) => tab.id).sort());
  await worker.evaluate(async (id) => globalThis.testToggleSearch(await chrome.tabs.get(id)), tabId);
  expect(await worker.evaluate(async () => (await chrome.tabs.query({})).map((tab) => tab.id).sort())).toEqual(before);
  expect(page.url()).toBe("chrome://version/");

  const popup = await attachActionPopup(context, `chrome-extension://${extensionId}/unavailable.html`, expect);
  try {
    expect(await popup.evaluate("document.querySelector('#senseek').shadowRoot.querySelector('.unavailable-message').textContent")).toBe("This page is not supported.");
    expect(await popup.evaluate("document.querySelector('#senseek').shadowRoot.querySelectorAll('input, a').length")).toBe(0);
    expect(await popup.evaluate("innerHeight")).toBeLessThan(100);
    expect(await popup.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    const screenshot = await popup.send("Page.captureScreenshot");
    await writeFile("test-results/unsupported-page.png", Buffer.from(screenshot.data, "base64"));
    await popup.evaluate("setTimeout(() => document.querySelector('#senseek').shadowRoot.querySelector('.close').click(), 0); true");
    await expect.poll(() => popup.isOpen()).toBe(false);
  } finally { await popup.detach(); }

  await worker.evaluate((apiKey) => chrome.storage.local.set({ apiKey }), testKey);
  await page.goto(baseUrl);
  await expect.poll(() => worker.evaluate((id) => chrome.action.getPopup({ tabId: id }), tabId)).toBe("");
  expect(await worker.evaluate((id) => chrome.action.getTitle({ tabId: id }), tabId)).toBe("Senseek · Find what you mean.");
  await worker.evaluate(async (id) => globalThis.testToggleSearch(await chrome.tabs.get(id)), tabId);
  await expect(page.getByRole("dialog", { name: "Senseek page search" })).toBeVisible();
  await query(page);
  await expect(page.locator(".count")).toHaveText("1 / 2");
  await worker.evaluate(async (id) => globalThis.testToggleSearch(await chrome.tabs.get(id)), tabId);
  await expect(page.getByRole("dialog", { name: "Senseek page search" })).toHaveCount(0);
});
