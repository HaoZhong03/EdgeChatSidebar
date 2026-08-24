export const DEFAULT_PROVIDER_ID = "deepseek";
export const DEEPSEEK_MULTIMODAL_MODEL = "deepseek-v4-flash-vision-exp";
export const MIMO_MULTIMODAL_MODEL = "mimo-v2.5";
export const DEEPSEEK_ANTHROPIC_ENDPOINT = "https://api.deepseek.com/anthropic/v1/messages";

const DEEPSEEK_WEB_SEARCH_MAX_TOKENS = 8192;
const DEEPSEEK_WEB_SEARCH_THINKING_TOKENS = 4096;

export const BUILTIN_PROVIDER_PROFILES = Object.freeze({
  deepseek: Object.freeze({
    id: "deepseek",
    label: "DeepSeek",
    type: "builtin",
    endpoint: "https://api.deepseek.com/chat/completions",
    models: Object.freeze([
      Object.freeze({ id: "deepseek-v4-flash", label: "deepseek-v4-flash" }),
      Object.freeze({ id: "deepseek-v4-pro", label: "deepseek-v4-pro" }),
      Object.freeze({
        id: DEEPSEEK_MULTIMODAL_MODEL,
        label: DEEPSEEK_MULTIMODAL_MODEL,
        capabilities: Object.freeze({ imageInput: true })
      })
    ]),
    defaultModel: "deepseek-v4-flash",
    auth: Object.freeze({ type: "bearer" }),
    capabilities: Object.freeze({
      maxOutputField: "max_tokens",
      streamUsage: "include_usage",
      thinking: "enabled",
      imageInput: false,
      webSearch: true
    })
  }),
  mimo: Object.freeze({
    id: "mimo",
    label: "小米 MiMo",
    type: "builtin",
    endpoint: "https://api.xiaomimimo.com/v1/chat/completions",
    models: Object.freeze([
      Object.freeze({
        id: MIMO_MULTIMODAL_MODEL,
        label: MIMO_MULTIMODAL_MODEL,
        capabilities: Object.freeze({ imageInput: true })
      }),
      Object.freeze({ id: "mimo-v2.5-pro", label: "mimo-v2.5-pro" })
    ]),
    defaultModel: "mimo-v2.5",
    auth: Object.freeze({ type: "api-key" }),
    capabilities: Object.freeze({
      maxOutputField: "max_completion_tokens",
      streamUsage: "implicit",
      thinking: "enabled",
      imageInput: false,
      webSearch: true
    })
  })
});

const UNKNOWN_PARAMETER_PATTERN = /(?:unknown|unsupported|unrecognized|unexpected|not\s+supported|not\s+(?:permitted|allowed)|extra(?:_forbidden|\s+(?:field|parameter|input))|invalid\s+(?:field|parameter)|未知|不支持|无法识别|非法参数)/i;

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
          : "auto",
        thinking: ["enabled", "unsupported"].includes(value.capabilityCache.thinking)
          ? value.capabilityCache.thinking
          : "auto"
      }
    : { maxOutputField: "auto", streamUsage: "auto", thinking: "auto" };

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
  const profiles = Object.values(BUILTIN_PROVIDER_PROFILES).map((profile) => {
    const config = normalized[profile.id];
    const selectedModel = profile.models.find((model) => model.id === config.model);
    return {
      ...profile,
      models: profile.models.map((model) => ({
        ...model,
        ...(model.capabilities ? { capabilities: { ...model.capabilities } } : {})
      })),
      auth: { ...profile.auth, apiKey: config.apiKey },
      capabilities: { ...profile.capabilities, ...(selectedModel?.capabilities || {}) },
      model: config.model
    };
  });

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
        thinking: config.capabilityCache.thinking,
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

export function buildDeepSeekAnthropicHeaders(profile) {
  const apiKey = cleanString(profile?.auth?.apiKey);
  return {
    ...(apiKey ? { "x-api-key": apiKey } : {}),
    "anthropic-version": "2023-06-01"
  };
}

function toApiMessage(message, profile) {
  const role = ["system", "user", "assistant", "tool"].includes(message?.role) ? message.role : "user";
  const text = typeof message?.content === "string" ? message.content : "";
  const images = Array.isArray(message?.images) ? message.images : [];

  if (profile.capabilities.imageInput && role === "user" && images.length > 0) {
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
    webSearchMode = "off",
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

  if (["enabled", "auto"].includes(profile.capabilities.thinking)) {
    body.thinking = { type: "enabled" };
  }

  if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
    const maxOutputField = overrides.maxOutputField
      || (profile.capabilities.maxOutputField === "auto" ? "max_tokens" : profile.capabilities.maxOutputField);
    body[maxOutputField] = Math.floor(maxOutputTokens);
  }

  if (profile.id === "mimo" && includeWebSearch && webSearchMode !== "off") {
    body.tools = [{
      type: "web_search",
      max_keyword: 3,
      force_search: webSearchMode === "force",
      limit: 1
    }];
  }

  return body;
}

function toAnthropicImageBlock(image) {
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/is.exec(image?.dataUrl || "");
  if (!match) return null;
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: match[1].toLowerCase(),
      data: match[2].replace(/\s/g, "")
    }
  };
}

export function buildDeepSeekWebSearchRequest(options) {
  const {
    profile,
    messages = [],
    systemPrompt = "",
    stream = true,
    maxOutputTokens,
    webSearchMode = "auto"
  } = options;
  const systemParts = [cleanString(systemPrompt)];
  const apiMessages = [];

  for (const message of messages) {
    const text = typeof message?.content === "string" ? message.content : "";
    if (message?.role === "system") {
      if (cleanString(text)) systemParts.push(cleanString(text));
      continue;
    }
    const role = message?.role === "assistant" ? "assistant" : "user";
    const imageBlocks = role === "user" && profile.capabilities.imageInput && Array.isArray(message?.images)
      ? message.images.map(toAnthropicImageBlock).filter(Boolean)
      : [];
    apiMessages.push({
      role,
      content: imageBlocks.length > 0
        ? [{ type: "text", text: text.trim() || "请分析这张图片。" }, ...imageBlocks]
        : text
    });
  }

  const requestedMaxTokens = Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
    ? Math.floor(maxOutputTokens)
    : DEEPSEEK_WEB_SEARCH_MAX_TOKENS;
  const body = {
    model: profile.model,
    messages: apiMessages,
    stream: Boolean(stream),
    max_tokens: requestedMaxTokens,
    thinking: {
      type: "enabled",
      budget_tokens: Math.min(DEEPSEEK_WEB_SEARCH_THINKING_TOKENS, Math.max(1, requestedMaxTokens - 1))
    }
  };
  const system = systemParts.filter(Boolean).join("\n\n");
  if (system) body.system = system;

  if (webSearchMode !== "off") {
    body.tools = [{
      type: "web_search_20260209",
      name: "web_search",
      max_uses: 3,
      allowed_callers: ["direct"]
    }];
    body.tool_choice = { type: webSearchMode === "force" ? "any" : "auto" };
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

export function normalizeAnthropicUsage(value, metadata = {}) {
  if (!value || typeof value !== "object") return null;
  const inputTokens = numberOrNull(value.input_tokens, value.inputTokens);
  const cacheCreationTokens = numberOrNull(value.cache_creation_input_tokens, value.cacheCreationInputTokens);
  const cacheReadTokens = numberOrNull(value.cache_read_input_tokens, value.cacheReadInputTokens);
  const outputTokens = numberOrNull(value.output_tokens, value.outputTokens);
  const inputParts = [inputTokens, cacheCreationTokens, cacheReadTokens].filter(Number.isFinite);
  const uncachedParts = [inputTokens, cacheCreationTokens].filter(Number.isFinite);
  const promptTokens = inputParts.length > 0 ? inputParts.reduce((sum, item) => sum + item, 0) : null;
  const uncachedPromptTokens = uncachedParts.length > 0 ? uncachedParts.reduce((sum, item) => sum + item, 0) : null;
  const outputDetails = value.output_tokens_details || value.outputTokensDetails || {};
  const serverToolUse = value.server_tool_use || value.serverToolUse || {};

  return normalizeUsage({
    prompt_tokens: promptTokens,
    completion_tokens: outputTokens,
    total_tokens: promptTokens !== null && outputTokens !== null ? promptTokens + outputTokens : null,
    cached_prompt_tokens: cacheReadTokens,
    uncached_prompt_tokens: uncachedPromptTokens,
    reasoning_tokens: numberOrNull(outputDetails.thinking_tokens, outputDetails.thinkingTokens),
    web_search_tool_usage: numberOrNull(serverToolUse.web_search_requests, serverToolUse.webSearchRequests)
  }, metadata);
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

function reasoningText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(reasoningText).join("");
  if (!value || typeof value !== "object") return "";
  return reasoningText(value.text ?? value.content ?? value.summary);
}

function splitLeadingThinkingBlock(value) {
  const opening = /^\s*<(think|thinking)>/i.exec(value);
  if (!opening) return { content: value, reasoning: "" };
  const remainder = value.slice(opening[0].length);
  const closing = /<\/(?:think|thinking)>/i.exec(remainder);
  if (!closing) return { content: "", reasoning: remainder };
  return {
    content: remainder.slice(closing.index + closing[0].length).replace(/^\s+/, ""),
    reasoning: remainder.slice(0, closing.index)
  };
}

export function createStreamAccumulator(metadata = {}) {
  let content = "";
  let reasoningContent = "";
  let usage = null;
  let done = false;
  let emitted = false;

  function snapshot(changed = false) {
    const tagged = metadata.extractTaggedReasoning
      ? splitLeadingThinkingBlock(content)
      : { content, reasoning: "" };
    const combinedReasoning = [reasoningContent, tagged.reasoning].filter(Boolean).join("\n");
    return {
      done,
      changed,
      content: tagged.content,
      reasoningContent: combinedReasoning,
      usage,
      emitted
    };
  }

  return {
    push(data) {
      const value = cleanString(data);
      if (!value) return snapshot();
      if (value === "[DONE]") {
        done = true;
        return snapshot();
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

      const choice = payload?.choices?.[0] || {};
      const delta = choice.delta || {};
      const message = choice.message || {};
      const nextContent = typeof delta.content === "string" ? delta.content : "";
      const reasoningCandidates = [
        delta.reasoning_content,
        delta.reasoning,
        delta.analysis,
        delta.thinking,
        delta.reasoning_text,
        delta.reasoning_details,
        message.reasoning_content,
        message.reasoning,
        message.analysis,
        message.thinking,
        message.reasoning_details
      ];
      const nextReasoning = reasoningCandidates.map(reasoningText).find(Boolean) || "";
      content += nextContent;
      reasoningContent += nextReasoning;
      const changed = Boolean(nextContent || nextReasoning);
      emitted ||= changed;
      return snapshot(changed);
    },
    result() {
      return snapshot();
    }
  };
}

function markdownSourceList(citations) {
  if (citations.length === 0) return "";
  const lines = citations.map(({ title, url }) => {
    const safeTitle = (title || url).replace(/[\[\]]/g, "");
    return `- [${safeTitle}](${url})`;
  });
  return `\n\n**来源**\n${lines.join("\n")}`;
}

export function createAnthropicStreamAccumulator(metadata = {}) {
  let content = "";
  let reasoningContent = "";
  let usageParts = {};
  let usage = null;
  let done = false;
  let emitted = false;
  const citations = new Map();

  function addCitation(value) {
    const rawUrl = cleanString(value?.url || value?.source?.url);
    if (!rawUrl) return;
    try {
      const url = new URL(rawUrl);
      if (!["http:", "https:"].includes(url.protocol)) return;
      citations.set(url.href, {
        url: url.href,
        title: cleanString(value?.title || value?.source?.title) || url.hostname
      });
    } catch {
      // Ignore malformed citation URLs returned by the provider.
    }
  }

  function mergeUsage(value) {
    if (!value || typeof value !== "object") return;
    usageParts = {
      ...usageParts,
      ...Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined)),
      server_tool_use: {
        ...(usageParts.server_tool_use || usageParts.serverToolUse || {}),
        ...(value.server_tool_use || value.serverToolUse || {})
      },
      output_tokens_details: {
        ...(usageParts.output_tokens_details || usageParts.outputTokensDetails || {}),
        ...(value.output_tokens_details || value.outputTokensDetails || {})
      }
    };
    usage = normalizeAnthropicUsage(usageParts, metadata);
  }

  function snapshot(changed = false) {
    return {
      done,
      changed,
      content: `${content}${done ? markdownSourceList([...citations.values()]) : ""}`,
      reasoningContent,
      usage,
      emitted
    };
  }

  return {
    push(data) {
      const value = cleanString(data);
      if (!value) return snapshot();

      let payload;
      try {
        payload = JSON.parse(value);
      } catch {
        throw new Error("DeepSeek 返回了无法解析的流式响应。");
      }

      if (payload?.type === "error" || payload?.error) {
        throw parseApiError(JSON.stringify(payload), 200);
      }

      if (payload?.type === "message_start") mergeUsage(payload.message?.usage);
      if (payload?.type === "message_delta") mergeUsage(payload.usage);

      let nextContent = "";
      let nextReasoning = "";
      if (payload?.type === "content_block_start") {
        const block = payload.content_block || {};
        if (block.type === "text") nextContent = typeof block.text === "string" ? block.text : "";
        if (block.type === "thinking") nextReasoning = typeof block.thinking === "string" ? block.thinking : "";
        if (Array.isArray(block.citations)) block.citations.forEach(addCitation);
      } else if (payload?.type === "content_block_delta") {
        const delta = payload.delta || {};
        if (delta.type === "text_delta") nextContent = typeof delta.text === "string" ? delta.text : "";
        if (delta.type === "thinking_delta") nextReasoning = typeof delta.thinking === "string" ? delta.thinking : "";
        if (delta.type === "citations_delta") addCitation(delta.citation);
      } else if (payload?.type === "message_stop") {
        done = true;
      }

      content += nextContent;
      reasoningContent += nextReasoning;
      const changed = Boolean(nextContent || nextReasoning);
      emitted ||= changed;
      return snapshot(changed);
    },
    result() {
      return snapshot();
    }
  };
}
