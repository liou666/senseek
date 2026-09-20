import test from "node:test";
import assert from "node:assert/strict";
import { apiRequest, makePayload, makeBatches, parseAnswers, searchPage, validateInput, verifyKey, validateKey } from "../extension/core/search.js";
import { sentenceSpans, splitTextSpans } from "../extension/core/text.js";

const blocks = [{ id: "b0", text: "You can cancel your subscription. Access remains until the current billing period ends." }, { id: "b1", text: "We charge a processing fee." }];
const input = { query: "How long can I use it after canceling?", blocks };
const answers = { b0: { type: "noul", noul: 0.91 }, focus_b0: { type: "choice", choice: "s1" }, b1: { type: "noul", noul: 0.2 } };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

test("direct JEV uses noul and choices of original source sentences", () => {
  const payload = makePayload(input);
  assert.equal(payload.model, "jev-latest");
  assert.equal(payload.questions.b0.type, "noul");
  assert.match(payload.questions.b0.instructions, /passage b0/);
  assert.equal(payload.questions.focus_b0.criteria.s1, "Access remains until the current billing period ends.");
  assert.equal(payload.questions.focus_b1, undefined);
  assert.equal(parseAnswers({ answers }, blocks)[0].focus.text, "Access remains until the current billing period ends.");
});

test("validates payload bounds and strips unintended fields before network use", () => {
  assert.deepEqual(validateInput({ ...input, key: "do-not-forward", blocks: [{ ...blocks[0], extra: "private" }] }), { query: input.query, blocks: [blocks[0]] });
  for (const invalid of [null, { ...input, query: " " }, { ...input, query: "a".repeat(401) }, { ...input, blocks: [blocks[0], blocks[0]] }, { ...input, blocks: [{ id: "b0", text: "x".repeat(1801) }] }, { ...input, blocks: Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, text: "x".repeat(1800) })) }]) {
    assert.throws(() => validateInput(invalid));
  }
  assert.equal(validateKey("  test-key  "), "test-key");
  for (const key of ["", "test\nkey", "clé", "test key"]) assert.throws(() => validateKey(key));
});

test("rejects missing scores, wrong gateway fields, and invented sentence indices", () => {
  for (const bad of [{}, { answers: [] }, { answers: { ...answers, b0: { probability: 0.9 } } }, { answers: { ...answers, b0: { noul: NaN } } }, { answers: { ...answers, focus_b0: { choice: "s80" } } }]) assert.throws(() => parseAnswers(bad, blocks));
});

test("Unicode, inline whitespace, and emoji offsets preserve UTF-16 source text", () => {
  const source = " Hello 👋!\nAccess remains available after canceling.\nHello again. ";
  for (const span of sentenceSpans(source)) assert.equal(source.slice(span.start, span.end), span.text);
  const long = "a".repeat(1799) + "😀" + "b".repeat(1850);
  const parts = splitTextSpans(long);
  assert.equal(parts.map((s) => s.text).join(""), long);
  assert(parts.every((s) => s.text.length <= 1800 && !/[\uD800-\uDBFF]$/.test(s.text)));
  assert(sentenceSpans("A. ".repeat(700)).length <= 120);
});

test("Multibyte text stays under context limits without dropping or duplicating blocks", () => {
  const page = Array.from({ length: 36 }, (_, i) => ({ id: `b${i}`, text: "x".repeat(1600) }));
  const batches = makeBatches(page);
  assert.deepEqual(batches.flat(), page);
  assert(batches.every((b) => b.length <= 20 && b.reduce((n, p) => n + p.text.length, 0) <= 8000));
});

test("calls only the official endpoint, ranks, filters, and omits credentials in results", async () => {
  let calls = 0;
  const result = await searchPage(input, { key: "test-private-key", fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init.headers.Authorization, "Bearer test-private-key");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(JSON.parse(init.body).questions.b0.type, "noul");
    return json({ answers });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.matches.map((m) => m.id), ["b0"]);
  assert(!JSON.stringify(result).includes("test-private-key"));
});

test("missing key and cancelled work do not reach the network", async () => {
  const fetchImpl = () => { throw new Error("must not be called"); };
  await assert.rejects(searchPage(input, { key: "", fetchImpl }), { code: "KEY_MISSING" });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(searchPage(input, { key: "fake", signal: controller.signal, fetchImpl }), { name: "AbortError" });
});

test("authentication failure never echoes upstream content or credentials", async () => {
  await assert.rejects(apiRequest("/v1/systemone", { key: "fake", fetchImpl: async () => json({ detail: "secret-leaked-server-message" }, 401) }), (error) => error.code === "KEY_INVALID" && !error.message.includes("secret-leaked"));
});

test("rate-limit retry honors Retry-After; long delays return an actionable error", async () => {
  let calls = 0, delay;
  const data = await apiRequest("/v1/models", { key: "fake", waitImpl: async (ms) => { delay = ms; }, fetchImpl: async () => ++calls === 1 ? json({}, 429, { "retry-after": "2" }) : json({ ok: true }) });
  assert.equal(calls, 2); assert.equal(delay, 2000); assert.equal(data.ok, true);
  await assert.rejects(apiRequest("/v1/models", { key: "fake", waitImpl: async () => assert.fail(), fetchImpl: async () => json({}, 429, { "retry-after": "60" }) }), { code: "API_ERROR" });
});

test("verification lists available models without submitting any page text", async () => {
  assert.deepEqual(await verifyKey("fake", { fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.typesafe.ai/v1/models"); assert.equal(init.method, "GET"); assert.equal(init.body, undefined);
    return json({ models: [{ name: "jev-latest" }] });
  } }), { ok: true });
  await assert.rejects(verifyKey("fake", { fetchImpl: async () => json({ models: [] }) }), { code: "MODEL_UNAVAILABLE" });
});

test("network cancellation and timeout cover response-body delivery", async () => {
  const controller = new AbortController();
  const stalled = (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new DOMException("abort", "AbortError"))); });
  const request = apiRequest("/v1/models", { key: "fake", signal: controller.signal, fetchImpl: stalled });
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  await assert.rejects(apiRequest("/v1/models", { key: "fake", timeoutMs: 5, fetchImpl: stalled }), { code: "TIMEOUT" });
  await assert.rejects(apiRequest("/v1/models", { key: "fake", fetchImpl: async () => new Response("<html>bad</html>") }), { code: "INVALID_RESPONSE" });
});

test("parallel batches are bounded and failing batches abort their peers", async () => {
  const page = { query: "relevant", blocks: Array.from({ length: 18 }, (_, i) => ({ id: `b${i}`, text: "x".repeat(1200) })) };
  let active = 0, maximum = 0;
  const result = await searchPage(page, { key: "fake", fetchImpl: async (_url, init) => {
    maximum = Math.max(maximum, ++active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return json({ answers: Object.fromEntries(JSON.parse(init.body).state.passages.map((b) => [b.id, { noul: 0.8 }])) });
  } });
  assert.equal(maximum, 2); assert.equal(result.matches.length, 18);
  let aborted = false, call = 0;
  await assert.rejects(searchPage(page, { key: "fake", fetchImpl: async (_url, init) => {
    if (++call === 1) return json({}, 401);
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => { aborted = true; reject(new DOMException("abort", "AbortError")); }));
  } }), { code: "KEY_INVALID" });
  assert.equal(aborted, true);
});
