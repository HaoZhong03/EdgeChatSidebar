import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthHeaders,
  buildChatCompletionRequest,
  createDefaultProviderConfigs,
  createStreamAccumulator,
  getProviderProfile,
  isExplicitUnknownParameterError,
  normalizeCustomProvider,
  normalizeProviderConfigs,
  normalizeUsage,
  parseApiError,
  validateCustomEndpoint
} from "../providers.js";

test("DeepSeek request follows its Chat Completions profile", () => {
  const configs = createDefaultProviderConfigs();
  configs.deepseek.apiKey = "secret";
  const profile = getProviderProfile(configs, "deepseek");
  const body = buildChatCompletionRequest({
    profile,
    messages: [{ role: "user", content: "hello" }],
    systemPrompt: "brief",
    stream: true,
    maxOutputTokens: 256
  });

  assert.equal(profile.endpoint, "https://api.deepseek.com/chat/completions");
  assert.deepEqual(buildAuthHeaders(profile), { Authorization: "Bearer secret" });
  assert.deepEqual(body, {
    model: "deepseek-v4-flash",
    messages: [
      { role: "system", content: "brief" },
      { role: "user", content: "hello" }
    ],
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: "enabled" },
    max_tokens: 256
  });
});

test("MiMo uses api-key, max_completion_tokens, implicit stream usage, image and search fields", () => {
  const configs = createDefaultProviderConfigs();
  configs.mimo.apiKey = "mimo-secret";
  const profile = getProviderProfile(configs, "mimo");
  const body = buildChatCompletionRequest({
    profile,
    messages: [{
      role: "user",
      content: "look",
      images: [{ dataUrl: "data:image/png;base64,AA==" }]
    }],
    stream: true,
    maxOutputTokens: 300,
    mimoWebSearchMode: "force"
  });

  assert.equal(profile.endpoint, "https://api.xiaomimimo.com/v1/chat/completions");
  assert.deepEqual(buildAuthHeaders(profile), { "api-key": "mimo-secret" });
  assert.equal(body.max_completion_tokens, 300);
  assert.equal("max_tokens" in body, false);
  assert.equal("stream_options" in body, false);
  assert.deepEqual(body.thinking, { type: "enabled" });
  assert.equal(body.messages[0].content[1].type, "image_url");
  assert.deepEqual(body.tools, [{ type: "web_search", max_keyword: 3, force_search: true, limit: 1 }]);
});

test("legacy MiMo endpoint overrides cannot replace the fixed official endpoint", () => {
  const configs = normalizeProviderConfigs({
    mimo: {
      apiKey: "key",
      apiUrl: "https://api.mimo.xiaomi.com/v1/chat/completions",
      model: "mimo-v2.5"
    }
  });
  assert.equal(getProviderProfile(configs, "mimo").endpoint, "https://api.xiaomimimo.com/v1/chat/completions");
});

test("custom providers support multiple models and optional Bearer auth", () => {
  const custom = normalizeCustomProvider({
    label: "Compatible",
    endpoint: "https://example.com/v1/chat/completions",
    apiKey: "token",
    models: "model-a\nmodel-b\nmodel-a"
  }, "custom-id");
  const configs = normalizeProviderConfigs({ ...createDefaultProviderConfigs(), [custom.id]: custom });
  const profile = getProviderProfile(configs, custom.id);

  assert.deepEqual(profile.models.map((model) => model.id), ["model-a", "model-b"]);
  assert.deepEqual(buildAuthHeaders(profile), { Authorization: "Bearer token" });
  profile.auth.apiKey = "";
  assert.deepEqual(buildAuthHeaders(profile), {});
  const body = buildChatCompletionRequest({
    profile,
    messages: [{ role: "user", content: "hello", images: [{ dataUrl: "data:image/png;base64,AA==" }] }],
    stream: true,
    maxOutputTokens: 100
  });
  assert.equal(body.messages[0].content, "hello");
  assert.equal(body.max_tokens, 100);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.deepEqual(body.thinking, { type: "enabled" });
  assert.equal("tools" in body, false);

  custom.capabilityCache.thinking = "unsupported";
  const noThinkingProfile = getProviderProfile(
    normalizeProviderConfigs({ ...createDefaultProviderConfigs(), [custom.id]: custom }),
    custom.id
  );
  assert.equal("thinking" in buildChatCompletionRequest({
    profile: noThinkingProfile,
    messages: [{ role: "user", content: "hello" }],
    stream: true
  }), false);
});

test("custom endpoint validation accepts HTTPS and loopback HTTP only", () => {
  assert.equal(validateCustomEndpoint("https://example.com/v1/chat/completions").permissionOrigin, "https://example.com/*");
  assert.equal(validateCustomEndpoint("http://localhost:1234/v1/chat/completions").permissionOrigin, "http://localhost:1234/*");
  assert.equal(validateCustomEndpoint("http://127.0.0.1/v1/chat/completions").origin, "http://127.0.0.1");
  assert.throws(() => validateCustomEndpoint("http://example.com/v1/chat/completions"), /HTTPS/);
  assert.throws(() => validateCustomEndpoint("https://user:pass@example.com/v1/chat/completions"), /用户名或密码/);
  assert.throws(() => validateCustomEndpoint("https://example.com/v1/chat/completions#x"), /fragment/);
  assert.throws(() => validateCustomEndpoint("http://localhost.example.com/v1/chat/completions"), /HTTPS/);
});

test("compatibility retry detection requires an explicit unknown-field client error", () => {
  const unknownStream = parseApiError('{"error":{"message":"Unknown parameter: stream_options"}}', 400);
  const authError = parseApiError('{"error":{"message":"Invalid API key; stream_options was present"}}', 401);
  assert.equal(isExplicitUnknownParameterError(unknownStream, "stream_options"), true);
  assert.equal(isExplicitUnknownParameterError(authError, "stream_options"), false);
  assert.equal(isExplicitUnknownParameterError(unknownStream, "max_tokens"), false);
  const forbiddenThinking = parseApiError('{"detail":[{"type":"extra_forbidden","loc":["body","thinking"]}]}', 422);
  assert.equal(isExplicitUnknownParameterError(forbiddenThinking, "thinking"), true);
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
