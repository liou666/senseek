import test from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, messages, normalizeLanguage, translate } from "../extension/core/i18n.js";
import { apiRequest, validateKey } from "../extension/core/search.js";

test("every language covers the full interface and preserves substitution parameters", () => {
  const parameters = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const language of LANGUAGES) {
    assert.deepEqual(Object.keys(messages[language]).sort(), Object.keys(messages.en).sort());
    for (const [key, value] of Object.entries(messages[language])) {
      assert.equal(typeof value, "string");
      assert(value.trim(), `${language}: ${key} is empty`);
      assert.deepEqual(parameters(value), parameters(messages.en[key]), `${language}: ${key} parameters differ`);
    }
  }
});

test("unknown saved languages fall back to English and values interpolate without changing source text", () => {
  for (const value of [undefined, null, "fr", "zh-TW", {}, "__proto__"]) {
    assert.equal(normalizeLanguage(value), "en");
    assert.equal(translate(value, "search.placeholder"), "Search meaning · Enter");
  }
  assert.equal(translate("zh-CN", "search.score", { percent: 96 }), "匹配度 96%");
  assert.equal(translate("ja", "search.countMany", { current: 2, total: 5 }), "5 件中 2 件目");
  assert.equal(translate("ja", ""), "");
});

test("validation and API errors carry translatable identities and safe parameters", async () => {
  assert.throws(() => validateKey("invalid key"), (error) => {
    assert.equal(error.code, "KEY_INVALID");
    assert.equal(translate("zh-CN", error.messageKey, error.params), "API 密钥格式无效，请检查是否含有空格或换行。");
    return true;
  });
  await assert.rejects(apiRequest("/v1/models", {
    key: "test-key",
    fetchImpl: async () => new Response("PRIVATE_UPSTREAM_ERROR", { status: 503 }),
  }), (error) => {
    assert.equal(error.code, "API_ERROR");
    assert.equal(error.messageKey, "error.http");
    assert.deepEqual(error.params, { status: 503 });
    assert.match(translate("ja", error.messageKey, error.params), /HTTP 503/);
    assert(!error.message.includes("PRIVATE_UPSTREAM_ERROR"));
    return true;
  });
});
