export const DEFAULT_PROVIDER_ID = "deepseek";
export const MIMO_MULTIMODAL_MODEL = "mimo-v2.5";

export const BUILTIN_PROVIDER_PROFILES = Object.freeze({
  deepseek: Object.freeze({
    id: "deepseek",
    label: "DeepSeek",
    type: "builtin",
    endpoint: "https://api.deepseek.com/chat/completions",
    models: Object.freeze([
      Object.freeze({ id: "deepseek-v4-flash", label: "deepseek-v4-flash" }),
      Object.freeze({ id: "deepseek-v4-pro", label: "deepseek-v4-pro" })
    ]),
    defaultModel: "deepseek-v4-flash",
    auth: Object.freeze({ type: "bearer" }),
    capabilities: Object.freeze({
      maxOutputField: "max_tokens",
      streamUsage: "include_usage",
      thinking: "enabled",
      imageInput: false,
      webSearch: false
    })
  }),
  mimo: Object.freeze({
    id: "mimo",
    label: "小米 MiMo",
    type: "builtin",
    endpoint: "https://api.xiaomimimo.com/v1/chat/completions",
    models: Object.freeze([
      Object.freeze({ id: "mimo-v2.5", label: "mimo-v2.5" }),
      Object.freeze({ id: "mimo-v2.5-pro", label: "mimo-v2.5-pro" })
    ]),
    defaultModel: "mimo-v2.5",
    auth: Object.freeze({ type: "api-key" }),
    capabilities: Object.freeze({
      maxOutputField: "max_completion_tokens",
      streamUsage: "implicit",
      thinking: "enabled",
      imageInput: true,
      webSearch: true
    })
  })
});

const UNKNOWN_PARAMETER_PATTERN = /(?:unknown|unsupported|unrecognized|unexpected|not\s+supported|extra\s+(?:field|parameter)|invalid\s+(?:field|parameter)|未知|不支持|无法识别|非法参数)/i;

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueModelIds(value) {
  const source = Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item : item?.id)
    : cleanString(value).split(/\r?\n/);
  return [...new Set(source.map(cleanString).filter(Boolean))];
}

export function createDefaultProviderConfigs() {
  return Object.fromEntries(Object.values(BUILTIN_PROVIDER_PROFILES).map((profile) => [
    profile.id,
    {
      id: profile.id,
      type: "builtin",
      apiKey: "",
      model: profile.defaultModel
    }
  ]));
}

export function validateCustomEndpoint(value) {
  const raw = cleanString(value);
  let url;

  try {
    url = new URL(raw);
  } catch {
    throw new Error("Endpoint 必须是完整 URL。");
  }

  if (url.username || url.password) {
    throw new Error("Endpoint 不能包含用户名或密码。");
  }
  if (url.hash) {
    throw new Error("Endpoint 不能包含 fragment。");
  }

  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("公网 Endpoint 必须使用 HTTPS；HTTP 仅允许 localhost 或 127.0.0.1。");
  }

  url.hash = "";
  return {
    endpoint: url.href,
    origin: url.origin,
    permissionOrigin: `${url.origin}/*`
  };
}

export function normalizeCustomProvider(value, existingId = "") {
  const label = cleanString(value?.label ?? value?.name);
  if (!label) {
    throw new Error("提供商名称不能为空。");
  }

  const { endpoint, origin, permissionOrigin } = validateCustomEndpoint(value?.endpoint ?? value?.apiUrl);
  const modelIds = uniqueModelIds(value?.models);
  if (modelIds.length === 0) {
    throw new Error("请至少填写一个模型 ID。");
  }

  const id = cleanString(existingId || value?.id) || crypto.randomUUID();
  const selectedModel = cleanString(value?.model);
  const capabilityCache = value?.capabilityCache && typeof value.capabilityCache === "object"
    ? {
        maxOutputField: ["max_tokens", "max_completion_tokens"].includes(value.capabilityCache.maxOutputField)
          ? value.capabilityCache.maxOutputField
          : "auto",
        streamUsage: ["include_usage", "implicit"].includes(value.capabilityCache.streamUsage)
          ? value.capabilityCache.streamUsage
          : "auto"
      }
    : { maxOutputField: "auto", streamUsage: "auto" };

  return {
    id,
    type: "custom",
    label,
    endpoint,
    origin,
    permissionOrigin,
    apiKey: cleanString(value?.apiKey),
    models: modelIds.map((modelId) => ({ id: modelId, label: modelId })),
    model: modelIds.includes(selectedModel) ? selectedModel : modelIds[0],
    capabilityCache
  };
}

export function normalizeProviderConfigs(value, legacyApiKey = "", legacyModel = "") {
  const defaults = createDefaultProviderConfigs();
  const source = value && typeof value === "object" ? value : {};

  for (const profile of Object.values(BUILTIN_PROVIDER_PROFILES)) {
    const config = source[profile.id] && typeof source[profile.id] === "object" ? source[profile.id] : {};
    const modelIds = profile.models.map((model) => model.id);
    defaults[profile.id] = {
      id: profile.id,
      type: "builtin",
      apiKey: cleanString(config.apiKey),
      model: modelIds.includes(cleanString(config.model)) ? cleanString(config.model) : profile.defaultModel
    };
  }

  if (!source.deepseek && legacyApiKey) {
    defaults.deepseek.apiKey = cleanString(legacyApiKey);
    if (BUILTIN_PROVIDER_PROFILES.deepseek.models.some((item) => item.id === legacyModel)) {
      defaults.deepseek.model = legacyModel;
    }
  }

  for (const [id, config] of Object.entries(source)) {
    if (id in BUILTIN_PROVIDER_PROFILES || config?.type !== "custom") continue;
    try {
      const normalized = normalizeCustomProvider(config, id);
      defaults[normalized.id] = normalized;
    } catch {
      // Invalid legacy custom providers are ignored instead of weakening endpoint validation.
    }
  }

  return defaults;
}

export function getProviderProfiles(configs) {
  const normalized = normalizeProviderConfigs(configs);
  const profiles = Object.values(BUILTIN_PROVIDER_PROFILES).map((profile) => ({
    ...profile,
    models: profile.models.map((model) => ({ ...model })),
    auth: { ...profile.auth, apiKey: normalized[profile.id].apiKey },
    capabilities: { ...profile.capabilities },
    model: normalized[profile.id].model
  }));

  for (const config of Object.values(normalized)) {
    if (config.type !== "custom") continue;
    profiles.push({
      id: config.id,
      label: config.label,
      type: "custom",
      endpoint: config.endpoint,
      models: config.models.map((model) => ({ ...model })),
      model: config.model,
      auth: { type: "bearer", apiKey: config.apiKey },
      capabilities: {
        maxOutputField: config.capabilityCache.maxOutputField,
        streamUsage: config.capabilityCache.streamUsage,
        thinking: "unsupported",
        imageInput: false,
        webSearch: false
      }
    });
  }

  return profiles;
}

export function getProviderProfile(configs, providerId) {
  const profiles = getProviderProfiles(configs);
  return profiles.find((profile) => profile.id === providerId) || profiles[0];
}

export function buildAuthHeaders(profile) {
  const apiKey = cleanString(profile?.auth?.apiKey);
  if (!apiKey) return {};
  return profile.auth.type === "api-key"
    ? { "api-key": apiKey }
    : { Authorization: `Bearer ${apiKey}` };
}

function toApiMessage(message, profile) {
  const role = ["system", "user", "assistant", "tool"].includes(message?.role) ? message.role : "user";
  const text = typeof message?.content === "string" ? message.content : "";
  const images = Array.isArray(message?.images) ? message.images : [];

  if (profile.id === "mimo" && profile.model === MIMO_MULTIMODAL_MODEL && role === "user" && images.length > 0) {
    return {
      role,
      content: [
        { type: "text", text: text.trim() || "请分析这张图片。" },
        ...images.filter((image) => typeof image?.dataUrl === "string").map((image) => ({
          type: "image_url",
          image_url: { url: image.dataUrl }
        }))
      ]
    };
  }

  return { role, content: text };
}

export function buildChatCompletionRequest(options) {
  const {
    profile,
    messages = [],
    systemPrompt = "",
    stream = true,
    maxOutputTokens,
    includeWebSearch = true,
    mimoWebSearchMode = "off",
    overrides = {}
  } = options;
  const apiMessages = messages.map((message) => toApiMessage(message, profile));
  if (cleanString(systemPrompt)) {
    apiMessages.unshift({ role: "system", content: cleanString(systemPrompt) });
  }

  const body = { model: profile.model, messages: apiMessages, stream: Boolean(stream) };
  const streamUsage = overrides.streamUsage || profile.capabilities.streamUsage;
  if (stream && (streamUsage === "include_usage" || streamUsage === "auto")) {
    body.stream_options = { include_usage: true };
  }

  if (profile.capabilities.thinking === "enabled") {
    body.thinking = { type: "enabled" };
  }

  if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
    const maxOutputField = overrides.maxOutputField
      || (profile.capabilities.maxOutputField === "auto" ? "max_tokens" : profile.capabilities.maxOutputField);
    body[maxOutputField] = Math.floor(maxOutputTokens);
  }

  if (profile.id === "mimo" && includeWebSearch && mimoWebSearchMode !== "off") {
    body.tools = [{
      type: "web_search",
      max_keyword: 3,
      force_search: mimoWebSearchMode === "force",
      limit: 1
    }];
  }

  return body;
}

function numberOrNull(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

export function normalizeUsage(value, metadata = {}) {
  if (!value || typeof value !== "object") return null;
  const promptDetails = value.prompt_tokens_details || value.promptTokensDetails || {};
  const completionDetails = value.completion_tokens_details || value.completionTokensDetails || {};
  const webSearchDetails = value.web_search_usage || value.webSearchUsage || {};
  const promptTokens = numberOrNull(value.prompt_tokens, value.promptTokens);
  const cachedPromptTokens = numberOrNull(
    value.cached_prompt_tokens,
    value.cachedPromptTokens,
    value.prompt_cache_hit_tokens,
    promptDetails.cached_tokens,
    promptDetails.cachedTokens
  );
  let uncachedPromptTokens = numberOrNull(
    value.uncached_prompt_tokens,
    value.uncachedPromptTokens,
    value.prompt_cache_miss_tokens,
    promptDetails.uncached_tokens,
    promptDetails.uncachedTokens
  );
  if (uncachedPromptTokens === null && promptTokens !== null && cachedPromptTokens !== null) {
    uncachedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens);
  }
  const usage = {
    promptTokens,
    completionTokens: numberOrNull(value.completion_tokens, value.completionTokens),
    totalTokens: numberOrNull(value.total_tokens, value.totalTokens),
    reasoningTokens: numberOrNull(value.reasoning_tokens, value.reasoningTokens, completionDetails.reasoning_tokens, completionDetails.reasoningTokens),
    cachedPromptTokens,
    uncachedPromptTokens,
    imageTokens: numberOrNull(value.image_tokens, value.imageTokens, promptDetails.image_tokens, promptDetails.imageTokens),
    audioTokens: numberOrNull(value.audio_tokens, value.audioTokens, promptDetails.audio_tokens, completionDetails.audio_tokens),
    videoTokens: numberOrNull(value.video_tokens, value.videoTokens, promptDetails.video_tokens),
    webSearchToolUsage: numberOrNull(
      value.web_search_tool_usage,
      value.webSearchToolUsage,
      value.web_search_requests,
      webSearchDetails.tool_usage,
      webSearchDetails.toolUsage
    ),
    webSearchPageUsage: numberOrNull(
      value.web_search_page_usage,
      value.webSearchPageUsage,
      value.web_search_pages,
      webSearchDetails.page_usage,
      webSearchDetails.pageUsage
    ),
    providerId: cleanString(metadata.providerId || value.providerId),
    model: cleanString(metadata.model || value.model),
    measuredAt: numberOrNull(metadata.measuredAt, value.measuredAt) || Date.now(),
    state: cleanString(metadata.state || value.state) || "measured"
  };

  const hasMeasuredField = Object.entries(usage).some(([key, item]) => (
    !["providerId", "model", "measuredAt", "state"].includes(key) && Number.isFinite(item)
  ));
  return hasMeasuredField ? usage : null;
}

export function parseApiError(text, status) {
  let message = cleanString(text) || `请求失败，状态码 ${status}`;
  try {
    const payload = JSON.parse(text);
    message = payload?.error?.message || payload?.message || message;
  } catch {
    // Keep the response body when it is not JSON.
  }
  const error = new Error(message);
  error.status = status;
  error.responseText = text;
  return error;
}

export function isExplicitUnknownParameterError(error, parameterName) {
  if (![400, 422].includes(Number(error?.status))) return false;
  const text = `${error?.message || ""} ${error?.responseText || ""}`;
  return text.toLowerCase().includes(parameterName.toLowerCase()) && UNKNOWN_PARAMETER_PATTERN.test(text);
}

export function createStreamAccumulator(metadata = {}) {
  let content = "";
  let reasoningContent = "";
  let usage = null;
  let done = false;
  let emitted = false;

  return {
    push(data) {
      const value = cleanString(data);
      if (!value) return { done, changed: false, content, reasoningContent, usage, emitted };
      if (value === "[DONE]") {
        done = true;
        return { done, changed: false, content, reasoningContent, usage, emitted };
      }

      let payload;
      try {
        payload = JSON.parse(value);
      } catch {
        throw new Error("模型返回了无法解析的流式响应。");
      }

      if (payload?.error) {
        throw parseApiError(JSON.stringify(payload), 200);
      }
      if (payload?.usage) {
        usage = normalizeUsage(payload.usage, metadata);
      }

      const delta = payload?.choices?.[0]?.delta || {};
      const nextContent = typeof delta.content === "string" ? delta.content : "";
      const nextReasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
      content += nextContent;
      reasoningContent += nextReasoning;
      const changed = Boolean(nextContent || nextReasoning);
      emitted ||= changed;
      return { done, changed, content, reasoningContent, usage, emitted };
    },
    result() {
      return { content, reasoningContent, usage, emitted, done };
    }
  };
}
