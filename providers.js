export const DEFAULT_PROVIDER_ID = "";

// Historical profiles are used only to import existing encrypted settings.
const LEGACY_PROVIDERS = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", models: ["deepseek-flash", "deepseek-v4-pro"] },
  mimo: { label: "小米 MiMo", baseUrl: "https://api.xiaomimimo.com/v1", models: ["mimo-v2.5", "mimo-v2.5-pro"] }
};

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
  return {};
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
  if (url.search) {
    throw new Error("Base URL 不能包含查询参数。");
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
  if (!label) throw new Error("提供商名称不能为空。");
  const apiFormat = value?.apiFormat === "anthropic" ? "anthropic" : "openai";
  const rawBase = (cleanString(value?.baseUrl) || cleanString(value?.endpoint ?? value?.apiUrl))
    .replace(/\/(?:chat\/completions|messages)\/?$/i, "");
  const { endpoint: baseUrl, origin, permissionOrigin } = validateCustomEndpoint(rawBase);
  const modelIds = uniqueModelIds(value?.models);
  if (!modelIds.length) throw new Error("请至少填写一个模型 ID。");
  const rawFields = Array.isArray(value?.optionalFields) ? value.optionalFields : [];
  const optionalFields = rawFields.map((field) => {
    const key = cleanString(field?.key);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ["model", "messages", "stream"].includes(key)) {
      throw new Error(`无效或保留的可选字段名：${key || "（空）"}`);
    }
    const rawValue = typeof field?.value === "string" ? field.value : JSON.stringify(field?.value);
    if (rawValue === undefined) throw new Error(`${key} 缺少 JSON 值。`);
    try { JSON.parse(rawValue); } catch { throw new Error(`${key} 的值必须是有效 JSON。字符串请加双引号。`); }
    return { key, value: rawValue };
  });
  if (new Set(optionalFields.map((field) => field.key)).size !== optionalFields.length) {
    throw new Error("可选字段名不能重复。");
  }
  const anthropicMaxTokens = optionalFields.find((field) => field.key === "max_tokens");
  if (apiFormat === "anthropic" && anthropicMaxTokens) {
    const value = JSON.parse(anthropicMaxTokens.value);
    if (!Number.isInteger(value) || value < 1) throw new Error("Anthropic 的 max_tokens 必须是正整数。");
  }
  const id = cleanString(existingId || value?.id) || crypto.randomUUID();
  const selectedModel = cleanString(value?.model);
  return {
    id, type: "custom", label, apiFormat, baseUrl,
    endpoint: `${baseUrl.replace(/\/$/, "")}/${apiFormat === "anthropic" ? "messages" : "chat/completions"}`,
    origin, permissionOrigin,
    apiKey: cleanString(value?.apiKey),
    models: modelIds.map((modelId) => ({ id: modelId, label: modelId })),
    model: modelIds.includes(selectedModel) ? selectedModel : modelIds[0],
    optionalFields,
    imageInput: value?.imageInput === true
  };
}

export function normalizeProviderConfigs(value, legacyApiKey = "", legacyModel = "") {
  const source = value && typeof value === "object" ? value : {};
  const configs = {};
  for (const [id, config] of Object.entries(source)) {
    try {
      if (Object.hasOwn(LEGACY_PROVIDERS, id) && config?.type !== "custom") {
        const legacy = LEGACY_PROVIDERS[id];
        configs[id] = normalizeCustomProvider({
          label: legacy.label, baseUrl: legacy.baseUrl, apiFormat: "openai",
          apiKey: config?.apiKey || (id === "deepseek" ? legacyApiKey : ""),
          models: legacy.models,
          model: id === "deepseek" && ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(config?.model)
            ? "deepseek-flash" : config?.model,
          imageInput: false
        }, id);
      } else if (config?.type === "custom") {
        configs[id] = normalizeCustomProvider(config, id);
      }
    } catch {
      // Invalid saved endpoints are ignored; endpoint validation is never relaxed.
    }
  }
  if (!configs.deepseek && legacyApiKey) {
    const legacy = LEGACY_PROVIDERS.deepseek;
    configs.deepseek = normalizeCustomProvider({
      label: legacy.label, baseUrl: legacy.baseUrl, apiKey: legacyApiKey,
      models: legacy.models, model: legacyModel, imageInput: false
    }, "deepseek");
  }
  return configs;
}

export function getProviderProfiles(configs) {
  return Object.values(normalizeProviderConfigs(configs)).map((config) => ({
    ...config,
    models: config.models.map((model) => ({ ...model })),
    auth: { type: config.apiFormat === "anthropic" ? "api-key" : "bearer", apiKey: config.apiKey },
    capabilities: { imageInput: config.imageInput, webSearch: false }
  }));
}

export function getProviderProfile(configs, providerId) {
  const profiles = getProviderProfiles(configs);
  return profiles.find((profile) => profile.id === providerId) || profiles[0] || null;
}

export function buildAuthHeaders(profile) {
  const apiKey = cleanString(profile?.auth?.apiKey);
  if (profile?.apiFormat === "anthropic") {
    return { ...(apiKey ? { "x-api-key": apiKey } : {}), "anthropic-version": "2023-06-01" };
  }
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
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

export function buildChatCompletionRequest({ profile, messages = [], systemPrompt = "", stream = true }) {
  const apiMessages = messages.map((message) => toApiMessage(message, profile));
  if (cleanString(systemPrompt)) apiMessages.unshift({ role: "system", content: cleanString(systemPrompt) });
  return {
    model: profile.model,
    messages: apiMessages,
    ...(stream ? { stream: true } : {}),
    ...Object.fromEntries(profile.optionalFields.map((field) => [field.key, JSON.parse(field.value)]))
  };
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

export function buildAnthropicRequest({ profile, messages = [], systemPrompt = "", stream = true, maxOutputTokens }) {
  const systemParts = [cleanString(systemPrompt)];
  const apiMessages = [];
  for (const message of messages) {
    const content = typeof message?.content === "string" ? message.content : "";
    if (message?.role === "system") {
      if (cleanString(content)) systemParts.push(cleanString(content));
      continue;
    }
    const role = message?.role === "assistant" ? "assistant" : "user";
    const images = role === "user" && profile.capabilities.imageInput && Array.isArray(message?.images)
      ? message.images.map(toAnthropicImageBlock).filter(Boolean) : [];
    apiMessages.push({ role, content: images.length
      ? [{ type: "text", text: content.trim() || "请分析这张图片。" }, ...images] : content });
  }
  const fields = Object.fromEntries(profile.optionalFields.map((field) => [field.key, JSON.parse(field.value)]));
  const body = {
    model: profile.model, messages: apiMessages,
    max_tokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? Math.floor(maxOutputTokens) : 4096,
    ...(stream ? { stream: true } : {}), ...fields
  };
  const system = systemParts.filter(Boolean).join("\n\n");
  if (system) body.system = system;
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
