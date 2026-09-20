import { test, expect, chromium } from "@playwright/test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

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
      answers[block.id] = { type: "noul", noul: behavior === "none" ? 0.1 : block.text.includes("After canceling, you keep access") ? 0.96 : block.text.includes("Canceling your subscription does not") ? 0.82 : 0.1 };
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
  await expect(page.getByRole("dialog", { name: "Senseek page search" })).toBeVisible();
  return page;
}
async function query(page, text = "Can I still use it after canceling?") {
  await page.getByRole("textbox", { name: "Search this page" }).fill(text);
  await page.getByRole("button", { name: "Start search", exact: true }).click();
}

test("settings persist locally, verify against models endpoint, and can be removed", async () => {
  const page = await options();
  await page.screenshot({ path: "test-results/settings-desktop.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  await page.locator("#api-key").fill(testKey);
  await page.getByRole("button", { name: "Show API key" }).click();
  await expect(page.locator("#api-key")).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide API key" }).click();
  await page.getByRole("button", { name: "Verify key", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Verified.");
  expect(requests[0].url).toContain("/v1/models");
  expect(requests[0].body).toBe(null);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator("#status")).toContainText("Saved.");
  await page.reload();
  await expect(page.locator("#api-key")).toHaveValue(testKey);
  expect(await worker.evaluate(() => chrome.storage.local.get("apiKey"))).toEqual({ apiKey: testKey });
  await page.getByRole("button", { name: "Remove saved key" }).click();
  await expect(page.locator("#api-key")).toHaveValue("");
  expect(await worker.evaluate(() => chrome.storage.local.get("apiKey"))).toEqual({});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/settings-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
  const sent = JSON.stringify(requests.filter((r) => r.body).map((r) => r.body));
  for (const secret of ["HIDDEN_SECRET", "INPUT_SECRET", "TEXTAREA_SECRET", "EDITABLE_SECRET", "ARIA_SECRET", "NAV_SECRET"]) expect(sent).not.toContain(secret);
  expect(sent).toContain("Team admins can");
  expect(sent).not.toContain(testKey);
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  const highlighted = await page.evaluate(() => [...CSS.highlights.get("jev-find-active")].map((range) => range.toString()));
  expect(highlighted).toEqual(["After canceling, you keep access to all features until the current billing period ends."]);
  expect((await page.locator(".panel").boundingBox()).y).toBe(16);
  const target = await page.locator("#cancellation").boundingBox();
  expect(Math.abs(target.y + target.height / 2 - 525)).toBeLessThan(10);
  await page.screenshot({ path: "test-results/search-results.png", fullPage: false });
  await page.getByRole("button", { name: "Next match" }).click();
  await expect(page.locator(".status")).toContainText("2 / 2");
  await page.getByRole("textbox", { name: "Search this page" }).focus();
  await page.keyboard.press("Shift+Enter");
  await expect(page.locator(".status")).toContainText("1 / 2");
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  await page.evaluate(() => { document.querySelector("#cancellation").textContent = "The page content has changed."; });
  await page.locator(".result").first().click();
  await expect(page.locator(".status")).toContainText("The page has changed");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("cancelled searches cannot paint stale results; no-match and auth errors remain actionable", async () => {
  const page = await article();
  behavior = "slow";
  await query(page);
  await expect(page.getByRole("button", { name: "Cancel search", exact: true })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole("button", { name: "Cancel search", exact: true }).click();
  await expect(page.locator(".status")).toContainText("Search canceled");
  await page.waitForTimeout(1800);
  await expect(page.locator(".result")).toHaveCount(0);
  behavior = "none";
  await query(page, "Where is the moon base?");
  await expect(page.locator(".status")).toContainText("No strong matches found");
  behavior = "unauthorized";
  await query(page);
  await expect(page.locator(".status")).toContainText("Your API key is invalid");
  await expect(page.getByRole("button", { name: "Add API key" })).toBeVisible();
  await expect(page.locator(".status")).not.toContainText("UNTRUSTED_ERROR_BODY");
  behavior = "network";
  await query(page);
  await expect(page.locator(".status")).toContainText("Could not connect to JEV");
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
  await expect(page.locator(".meta")).toContainText("Partial page");
  await expect(page.locator(".status")).toContainText("No strong matches found");
  const captured = requests.filter((r) => r.body).flatMap((r) => r.body.state.passages);
  expect(captured.length).toBeLessThanOrEqual(160);
  expect(captured.reduce((n, b) => n + b.text.length, 0)).toBeLessThanOrEqual(60000);
  expect(new Set(captured.map((b) => b.id)).size).toBe(captured.length);
  expect(pageErrors).toEqual([]);
});
