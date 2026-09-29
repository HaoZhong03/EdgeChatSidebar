import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  buildAnthropicRequest, buildAuthHeaders, buildChatCompletionRequest,
  createAnthropicStreamAccumulator, createDefaultProviderConfigs,
  createStreamAccumulator, getProviderProfile, getProviderProfiles,
  normalizeAnthropicUsage, normalizeCustomProvider, normalizeProviderConfigs,
  normalizeUsage, validateCustomEndpoint
} from "../providers.js";

globalThis.crypto ??= webcrypto;

test("new installs start without a provider or hidden request fields", () => {
  assert.deepEqual(createDefaultProviderConfigs(), {});
  assert.deepEqual(getProviderProfiles({}), []);
  const config = normalizeCustomProvider({ label: "Example", baseUrl: "https://example.com/v1", models: "a\nb", apiKey: "secret" }, "custom-id");
  const profile = getProviderProfile({ [config.id]: config }, config.id);
  assert.equal(profile.endpoint, "https://example.com/v1/chat/completions");
  assert.deepEqual(buildAuthHeaders(profile), { Authorization: "Bearer secret" });
  assert.deepEqual(buildChatCompletionRequest({ profile, messages: [{ role: "user", content: "hi" }] }), {
    model: "a", messages: [{ role: "user", content: "hi" }], stream: true
  });
  assert.deepEqual(buildChatCompletionRequest({ profile, messages: [], stream: false }), { model: "a", messages: [] });
});

test("optional fields use explicit JSON values and reject required or malformed fields", () => {
  const config = normalizeCustomProvider({ label: "Example", baseUrl: "https://example.com", models: "m",
    optionalFields: [{ key: "temperature", value: "0.7" }, { key: "thinking", value: '{"type":"enabled"}' }, { key: "metadata", value: "null" }] }, "id");
  const profile = getProviderProfile({ id: config }, "id");
  assert.deepEqual(buildChatCompletionRequest({ profile, messages: [] }), {
    model: "m", messages: [], stream: true, temperature: 0.7, thinking: { type: "enabled" }, metadata: null
  });
  assert.throws(() => normalizeCustomProvider({ label: "x", baseUrl: "https://x.test", models: "m", optionalFields: [{ key: "model", value: '"x"' }] }), /保留/);
  assert.throws(() => normalizeCustomProvider({ label: "x", baseUrl: "https://x.test", models: "m", optionalFields: [{ key: "tools", value: "not JSON" }] }), /JSON/);
  assert.throws(() => normalizeCustomProvider({ label: "x", baseUrl: "https://x.test", apiFormat: "anthropic", models: "m", optionalFields: [{ key: "max_tokens", value: "null" }] }), /正整数/);
});

test("Anthropic format builds required messages and configured fields", () => {
  const config = normalizeCustomProvider({ label: "Anthropic", apiFormat: "anthropic", baseUrl: "https://example.com/v1", apiKey: "key", models: "m",
    optionalFields: [{ key: "temperature", value: "0.2" }] }, "id");
  const profile = getProviderProfile({ id: config }, "id");
  assert.equal(profile.endpoint, "https://example.com/v1/messages");
  assert.deepEqual(buildAuthHeaders(profile), { "x-api-key": "key", "anthropic-version": "2023-06-01" });
  assert.deepEqual(buildAnthropicRequest({ profile, messages: [{ role: "user", content: "hi" }], stream: false }), {
    model: "m", messages: [{ role: "user", content: "hi" }], max_tokens: 4096, temperature: 0.2
  });
});

test("saved built-in models migrate into editable custom providers with secrets", () => {
  const configs = normalizeProviderConfigs({ deepseek: { type: "builtin", apiKey: "deep-secret", model: "deepseek-v4-flash" },
    mimo: { type: "builtin", apiKey: "mimo-secret", model: "mimo-v2.5" } });
  assert.equal(configs.deepseek.type, "custom");
  assert.equal(configs.deepseek.model, "deepseek-flash");
  assert.equal(configs.deepseek.apiKey, "deep-secret");
  assert.equal(configs.mimo.apiKey, "mimo-secret");
  assert.equal(configs.mimo.baseUrl, "https://api.xiaomimimo.com/v1");
  const custom = normalizeProviderConfigs({ legacy: { type: "custom", label: "Old", endpoint: "https://example.com/v1/chat/completions", models: ["m"] } });
  assert.equal(custom.legacy.endpoint, "https://example.com/v1/chat/completions");
});

test("base URL validation restricts public HTTP and rejects embedded credentials", () => {
  assert.equal(validateCustomEndpoint("http://localhost:1234/v1").permissionOrigin, "http://localhost:1234/*");
  assert.throws(() => validateCustomEndpoint("http://example.com/v1"), /HTTPS/);
  assert.throws(() => validateCustomEndpoint("https://u:p@example.com"), /用户名或密码/);
  assert.throws(() => validateCustomEndpoint("https://example.com/v1?x=1"), /查询参数/);
});

test("usage mapping keeps only measured provider fields", () => {
  const usage = normalizeUsage({
    prompt_tokens: 120,
    completion_tokens: 40,
    total_tokens: 160,
    prompt_cache_hit_tokens: 80,
    prompt_cache_miss_tokens: 40,
    completion_tokens_details: { reasoning_tokens: 10 },
    image_tokens: 12,
    web_search_usage: { tool_usage: 1, page_usage: 3 }
  }, { providerId: "mimo", model: "mimo-v2.5", measuredAt: 123 });

  assert.deepEqual(usage, {
    promptTokens: 120,
    completionTokens: 40,
    totalTokens: 160,
    reasoningTokens: 10,
    cachedPromptTokens: 80,
    uncachedPromptTokens: 40,
    imageTokens: 12,
    audioTokens: null,
    videoTokens: null,
    webSearchToolUsage: 1,
    webSearchPageUsage: 3,
    providerId: "mimo",
    model: "mimo-v2.5",
    measuredAt: 123,
    state: "measured"
  });
  assert.equal(normalizeUsage(usage, usage).audioTokens, null);
  assert.equal(normalizeUsage({ request_id: "x" }), null);
});

test("Anthropic usage maps total input cache and DeepSeek web-search calls", () => {
  const usage = normalizeAnthropicUsage({
    input_tokens: 10,
    cache_creation_input_tokens: 2,
    cache_read_input_tokens: 3,
    output_tokens: 4,
    output_tokens_details: { thinking_tokens: 2 },
    server_tool_use: { web_search_requests: 1 }
  }, { providerId: "deepseek", model: "deepseek-v4-pro", measuredAt: 123 });

  assert.equal(usage.promptTokens, 15);
  assert.equal(usage.cachedPromptTokens, 3);
  assert.equal(usage.uncachedPromptTokens, 12);
  assert.equal(usage.completionTokens, 4);
  assert.equal(usage.totalTokens, 19);
  assert.equal(usage.reasoningTokens, 2);
  assert.equal(usage.webSearchToolUsage, 1);
});

test("SSE accumulator accepts reasoning, nullable deltas, empty-choice usage chunks and DONE", () => {
  const stream = createStreamAccumulator({ providerId: "deepseek", model: "model" });
  stream.push('{"choices":[{"delta":{"reasoning_content":"think","content":null}}]}');
  stream.push('{"choices":[{"delta":{"content":"answer"}}]}');
  stream.push('{"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2,"total_tokens":11}}');
  stream.push("[DONE]");
  const result = stream.result();
  assert.equal(result.reasoningContent, "think");
  assert.equal(result.content, "answer");
  assert.equal(result.usage.promptTokens, 9);
  assert.equal(result.done, true);
});

test("DeepSeek Anthropic SSE accumulates thinking text usage and cited sources", () => {
  const stream = createAnthropicStreamAccumulator({
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    measuredAt: 123
  });
  stream.push('{"type":"message_start","message":{"usage":{"input_tokens":10,"cache_creation_input_tokens":2,"cache_read_input_tokens":3,"output_tokens":1}}}');
  stream.push('{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"think"}}');
  stream.push('{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"answer"}}');
  stream.push('{"type":"content_block_delta","index":1,"delta":{"type":"citations_delta","citation":{"type":"web_search_result_location","url":"https://example.com/source","title":"Example source"}}}');
  stream.push('{"type":"message_delta","usage":{"output_tokens":4,"output_tokens_details":{"thinking_tokens":2},"server_tool_use":{"web_search_requests":1}}}');
  stream.push('{"type":"message_stop"}');

  const result = stream.result();
  assert.equal(result.reasoningContent, "think");
  assert.equal(result.content, "answer\n\n**来源**\n- [Example source](https://example.com/source)");
  assert.equal(result.usage.promptTokens, 15);
  assert.equal(result.usage.totalTokens, 19);
  assert.equal(result.usage.webSearchToolUsage, 1);
  assert.equal(result.done, true);
});

test("SSE accumulator accepts common custom-provider reasoning aliases", () => {
  const stream = createStreamAccumulator({ providerId: "custom", model: "reasoner" });
  stream.push('{"choices":[{"delta":{"reasoning":"one"}}]}');
  stream.push('{"choices":[{"delta":{"analysis":" two"}}]}');
  stream.push('{"choices":[{"delta":{"thinking":" three"}}]}');
  stream.push('{"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":" four"}]}}]}');
  stream.push('{"choices":[{"delta":{"content":"answer"}}]}');
  assert.equal(stream.result().reasoningContent, "one two three four");
  assert.equal(stream.result().content, "answer");
});

test("custom SSE accumulator separates a leading think block from answer content", () => {
  const stream = createStreamAccumulator({
    providerId: "custom",
    model: "reasoner",
    extractTaggedReasoning: true
  });
  stream.push('{"choices":[{"delta":{"content":"<think>first"}}]}');
  stream.push('{"choices":[{"delta":{"content":" second</think>answer"}}]}');
  assert.equal(stream.result().reasoningContent, "first second");
  assert.equal(stream.result().content, "answer");
});
