const STORAGE_KEYS = {
  activeProvider: "activeModelProvider",
  providerConfigs: "modelProviderConfigs",
  mimoWebSearchMode: "mimoWebSearchMode",
  theme: "deepseekTheme",
  systemPrompt: "deepseekSystemPrompt",
  messages: "deepseekMessages",
  sessions: "deepseekSessions",
  currentSessionId: "deepseekCurrentSessionId",
  legacyApiKey: "deepseekApiKey",
  legacyModel: "deepseekModel"
};

const MODEL_PROVIDERS = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    apiUrl: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    supportsThinking: true,
    includeStreamUsage: true,
    streamUnsupportedMessage: "当前浏览器不支持读取 DeepSeek 流式响应。",
    parseErrorMessage: "DeepSeek 返回了无法解析的流式响应。",
    emptyResponseMessage: "DeepSeek 没有返回可显示的内容。"
  },
  mimo: {
    id: "mimo",
    label: "小米 MiMo",
    apiUrl: "https://api.xiaomimimo.com/v1/chat/completions",
    defaultModel: "mimo-v2.5",
    models: ["mimo-v2.5", "mimo-v2.5-pro"],
    supportsThinking: false,
    includeStreamUsage: false,
    authHeader: "api-key",
    streamUnsupportedMessage: "当前浏览器不支持读取小米 MiMo 流式响应。",
    parseErrorMessage: "小米 MiMo 返回了无法解析的流式响应。",
    emptyResponseMessage: "小米 MiMo 没有返回可显示的内容。"
  }
};

const DEFAULT_PROVIDER_ID = "deepseek";
const DEFAULT_THEME = "system";

const modelSwitchButton = document.getElementById("modelSwitchButton");
const modelMenu = document.getElementById("modelMenu");
const tokenUsageText = document.getElementById("tokenUsageText");
const settingsButton = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsPanel");
const closeSettingsButton = document.getElementById("closeSettingsButton");
const historyButton = document.getElementById("historyButton");
const historyPanel = document.getElementById("historyPanel");
const closeHistoryButton = document.getElementById("closeHistoryButton");
const newChatButton = document.getElementById("newChatButton");
const historyList = document.getElementById("historyList");
const historyNotice = document.getElementById("historyNotice");
const historyNoticeText = document.getElementById("historyNoticeText");
const closeHistoryNoticeButton = document.getElementById("closeHistoryNoticeButton");
const deepseekApiKeyInput = document.getElementById("deepseekApiKeyInput");
const deepseekEndpointInput = document.getElementById("deepseekEndpointInput");
const mimoApiKeyInput = document.getElementById("mimoApiKeyInput");
const mimoEndpointInput = document.getElementById("mimoEndpointInput");
const themeSelect = document.getElementById("themeSelect");
const systemPromptInput = document.getElementById("systemPromptInput");
const mimoWebSearchModeSelect = document.getElementById("mimoWebSearchModeSelect");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const clearChatButton = document.getElementById("clearChatButton");
const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const composerResizeHandle = document.getElementById("composerResizeHandle");
const pendingImagesEl = document.getElementById("pendingImages");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

const COMPOSER_MIN_HEIGHT = 64;
const COMPOSER_IMAGE_MIN_HEIGHT = 124;
const COMPOSER_MAX_MARGIN = 120;
const DEFAULT_MIMO_WEB_SEARCH_MODE = "off";
const MIMO_WEB_SEARCH_MODES = ["off", "auto", "force"];
const MIMO_MULTIMODAL_MODEL = "mimo-v2.5";
const DEFAULT_IMAGE_PROMPT = "请分析这张图片。";
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 4;

let settings = {
  activeProvider: DEFAULT_PROVIDER_ID,
  providerConfigs: createDefaultProviderConfigs(),
  mimoWebSearchMode: DEFAULT_MIMO_WEB_SEARCH_MODE,
  theme: DEFAULT_THEME,
  systemPrompt: "",
  messages: [],
  sessions: [],
  currentSessionId: ""
};
let pendingImages = [];
let isRequestInFlight = false;
let editingMessageIndex = -1;

function storageGet(keys) {
  if (!globalThis.chrome?.storage?.local) {
    const result = {};
    for (const key of keys) {
      const rawValue = localStorage.getItem(key);
      if (rawValue === null) continue;

      try {
        result[key] = JSON.parse(rawValue);
      } catch {
        result[key] = rawValue;
      }
    }
    return Promise.resolve(result);
  }

  return chrome.storage.local.get(keys);
}

function storageSet(value) {
  if (!globalThis.chrome?.storage?.local) {
    for (const [key, nextValue] of Object.entries(value)) {
      localStorage.setItem(key, JSON.stringify(nextValue));
    }
    return Promise.resolve();
  }

  return chrome.storage.local.set(value);
}

function createDefaultProviderConfigs() {
  return Object.fromEntries(
    Object.values(MODEL_PROVIDERS).map((provider) => [
      provider.id,
      {
        apiKey: "",
        apiUrl: provider.apiUrl,
        model: provider.defaultModel
      }
    ])
  );
}

function normalizeProviderConfigs(value, legacyApiKey = "", legacyModel = "") {
  const defaults = createDefaultProviderConfigs();
  const source = value && typeof value === "object" ? value : {};

  for (const provider of Object.values(MODEL_PROVIDERS)) {
    const config = source[provider.id] && typeof source[provider.id] === "object" ? source[provider.id] : {};
    defaults[provider.id] = {
      apiKey: typeof config.apiKey === "string" ? config.apiKey : defaults[provider.id].apiKey,
      apiUrl: typeof config.apiUrl === "string" && config.apiUrl.trim()
        ? config.apiUrl.trim()
        : defaults[provider.id].apiUrl,
      model: typeof config.model === "string" && config.model.trim()
        ? config.model.trim()
        : defaults[provider.id].model
    };
  }

  if (!source.deepseek && legacyApiKey) {
    defaults.deepseek.apiKey = legacyApiKey;
    defaults.deepseek.model = legacyModel || defaults.deepseek.model;
  }

  if (defaults.mimo.apiUrl === "https://api.mimo.xiaomi.com/v1/chat/completions") {
    defaults.mimo.apiUrl = MODEL_PROVIDERS.mimo.apiUrl;
  }

  if (!MODEL_PROVIDERS.mimo.models.includes(defaults.mimo.model)) {
    defaults.mimo.model = MODEL_PROVIDERS.mimo.defaultModel;
  }

  return defaults;
}

function getActiveProvider() {
  return MODEL_PROVIDERS[settings.activeProvider] || MODEL_PROVIDERS[DEFAULT_PROVIDER_ID];
}

function getActiveProviderConfig() {
  const provider = getActiveProvider();
  return settings.providerConfigs[provider.id] || createDefaultProviderConfigs()[provider.id];
}

function normalizeMimoWebSearchMode(value) {
  return MIMO_WEB_SEARCH_MODES.includes(value) ? value : DEFAULT_MIMO_WEB_SEARCH_MODE;
}

function updateModelSwitchLabel(status = "") {
  const provider = getActiveProvider();
  const config = getActiveProviderConfig();
  const connection = config.apiKey ? "已连接" : "未配置";
  const prefix = status || connection;
  modelSwitchButton.textContent = `${prefix} · ${config.model}`;
  modelSwitchButton.title = `当前模型：${provider.label} / ${config.model}。点击展开模型列表。`;
  modelSwitchButton.setAttribute("aria-label", `切换模型，当前为 ${provider.label} ${config.model}`);
  renderModelMenu();
}

function renderModelMenu() {
  modelMenu.innerHTML = "";

  for (const provider of Object.values(MODEL_PROVIDERS)) {
    const group = document.createElement("div");
    group.className = "model-menu-group";

    const label = document.createElement("div");
    label.className = "model-menu-label";
    label.textContent = provider.label;
    group.appendChild(label);

    const config = settings.providerConfigs[provider.id] || createDefaultProviderConfigs()[provider.id];

    for (const model of provider.models) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "model-menu-option";
      option.dataset.providerId = provider.id;
      option.dataset.model = model;

      if (settings.activeProvider === provider.id && config.model === model) {
        option.classList.add("selected");
        option.setAttribute("aria-current", "true");
      }

      const modelText = document.createElement("span");
      modelText.className = "model-menu-model";
      modelText.textContent = model;

      const providerText = document.createElement("span");
      providerText.className = "model-menu-provider";
      providerText.textContent = provider.label;

      option.append(modelText, providerText);
      group.appendChild(option);
    }

    modelMenu.appendChild(group);
  }
}

function openModelMenu() {
  renderModelMenu();
  modelMenu.hidden = false;
  modelSwitchButton.setAttribute("aria-expanded", "true");
}

function closeModelMenu() {
  modelMenu.hidden = true;
  modelSwitchButton.setAttribute("aria-expanded", "false");
}

function toggleModelMenu() {
  if (modelMenu.hidden) {
    openModelMenu();
    return;
  }

  closeModelMenu();
}

function formatTokenCount(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const promptTokens = Number(value.prompt_tokens ?? value.promptTokens);
  const completionTokens = Number(value.completion_tokens ?? value.completionTokens);
  const totalTokens = Number(value.total_tokens ?? value.totalTokens);

  return {
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : null,
    completionTokens: Number.isFinite(completionTokens) ? completionTokens : null,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : null
  };
}

function getLatestTokenUsage(messages = settings.messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = normalizeUsage(messages[index]?.usage);
    if (usage) {
      return usage;
    }
  }

  return null;
}

function updateTokenUsageDisplay(usage = getLatestTokenUsage()) {
  const contextTokens = usage?.promptTokens ?? usage?.totalTokens;

  if (!Number.isFinite(contextTokens)) {
    tokenUsageText.hidden = true;
    tokenUsageText.textContent = "";
    return;
  }

  tokenUsageText.hidden = false;
  tokenUsageText.textContent = `${formatTokenCount(contextTokens)} tokens`;
}

function getLatestEditableUserMessageIndex(messages = settings.messages) {
  if (isRequestInFlight || editingMessageIndex !== -1) {
    return -1;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

function applyTheme(theme) {
  const nextTheme = ["light", "dark", "system"].includes(theme) ? theme : DEFAULT_THEME;
  document.documentElement.dataset.theme = nextTheme;
}

function getMessageText(message) {
  return typeof message?.content === "string" ? message.content : "";
}

function normalizeImageAttachments(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((image) => (
      image
      && typeof image.dataUrl === "string"
      && image.dataUrl.startsWith("data:image/")
      && typeof image.mimeType === "string"
      && SUPPORTED_IMAGE_MIME_TYPES.has(image.mimeType)
    ))
    .slice(0, MAX_IMAGES_PER_MESSAGE)
    .map((image, index) => ({
      id: typeof image.id === "string" && image.id ? image.id : `image-${Date.now()}-${index}`,
      name: typeof image.name === "string" ? image.name : "clipboard-image",
      mimeType: image.mimeType,
      size: Number.isFinite(image.size) ? image.size : 0,
      dataUrl: image.dataUrl
    }));
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object") {
    return { role: "user", content: "" };
  }

  return {
    ...message,
    role: typeof message.role === "string" ? message.role : "user",
    content: typeof message.content === "string" ? message.content : "",
    images: normalizeImageAttachments(message.images)
  };
}

function isMimoMultimodalConfig(provider, config) {
  return provider.id === "mimo" && config.model === MIMO_MULTIMODAL_MODEL;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "未知大小";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getComposerMinHeight() {
  return pendingImages.length > 0 ? COMPOSER_IMAGE_MIN_HEIGHT : COMPOSER_MIN_HEIGHT;
}

function createSession(messages = []) {
  const now = Date.now();

  return {
    id: `session-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: buildSessionTitle(messages),
    messages,
    createdAt: now,
    updatedAt: now
  };
}

function buildSessionTitle(messages) {
  const firstUserMessage = messages.find((message) => (
    message.role === "user"
    && (getMessageText(message).trim() || normalizeImageAttachments(message.images).length > 0)
  ));
  const title = getMessageText(firstUserMessage).trim()
    || (firstUserMessage ? "图片消息" : "新对话");

  return title.length > 24 ? `${title.slice(0, 24)}...` : title;
}

function normalizeSessions(value, legacyMessages) {
  const sessions = Array.isArray(value)
    ? value
        .filter((session) => session && typeof session.id === "string")
        .map((session) => ({
          id: session.id,
          title: session.title || buildSessionTitle(Array.isArray(session.messages) ? session.messages : []),
          messages: Array.isArray(session.messages) ? session.messages.map(normalizeMessage) : [],
          createdAt: Number.isFinite(session.createdAt) ? session.createdAt : Date.now(),
          updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : Date.now()
        }))
    : [];

  if (sessions.length > 0) {
    return sessions;
  }

  if (Array.isArray(legacyMessages) && legacyMessages.length > 0) {
    return [createSession(legacyMessages.map(normalizeMessage))];
  }

  return [createSession()];
}

function getCurrentSession() {
  let session = settings.sessions.find((item) => item.id === settings.currentSessionId);

  if (!session) {
    session = settings.sessions[0] || createSession();
    if (!settings.sessions.includes(session)) {
      settings.sessions.unshift(session);
    }
    settings.currentSessionId = session.id;
  }

  return session;
}

function syncCurrentSessionMessages() {
  const session = getCurrentSession();
  settings.messages = session.messages;
}

async function saveSessions() {
  await storageSet({
    [STORAGE_KEYS.sessions]: settings.sessions,
    [STORAGE_KEYS.currentSessionId]: settings.currentSessionId,
    [STORAGE_KEYS.messages]: settings.messages
  });
}

async function saveCurrentSession() {
  const session = getCurrentSession();
  session.messages = settings.messages;
  session.title = buildSessionTitle(settings.messages);
  session.updatedAt = Date.now();

  settings.sessions = [
    session,
    ...settings.sessions.filter((item) => item.id !== session.id)
  ];

  await saveSessions();
}

function formatSessionTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function renderHistory() {
  historyList.innerHTML = "";

  if (settings.sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "暂无历史对话";
    historyList.appendChild(empty);
    return;
  }

  for (const session of settings.sessions) {
    const item = document.createElement("div");
    item.className = `history-item${session.id === settings.currentSessionId ? " current" : ""}`;

    const selectButton = document.createElement("button");
    selectButton.className = "history-select";
    selectButton.type = "button";
    selectButton.dataset.sessionId = session.id;

    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = session.title || "新对话";

    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = `${session.messages.length} 条 · ${formatSessionTime(session.updatedAt)}`;

    selectButton.append(title, meta);

    const deleteButton = document.createElement("button");
    deleteButton.className = "history-delete";
    deleteButton.type = "button";
    deleteButton.dataset.sessionId = session.id;
    deleteButton.setAttribute("aria-label", `删除 ${session.title || "新对话"}`);
    deleteButton.setAttribute("title", "删除");
    const deleteIcon = document.createElement("span");
    deleteIcon.className = "history-delete-icon";
    deleteIcon.setAttribute("aria-hidden", "true");
    deleteButton.appendChild(deleteIcon);

    const compressButton = document.createElement("button");
    compressButton.className = "history-compress";
    compressButton.type = "button";
    compressButton.dataset.sessionId = session.id;
    compressButton.setAttribute("aria-label", `压缩 ${session.title || "新对话"} 的上下文`);
    compressButton.setAttribute("title", "压缩上下文");
    const compressIcon = document.createElement("span");
    compressIcon.className = "history-compress-icon";
    compressIcon.setAttribute("aria-hidden", "true");
    compressButton.appendChild(compressIcon);

    item.append(selectButton, compressButton, deleteButton);
    historyList.appendChild(item);
  }
}

function showHistoryNotice(message) {
  historyNoticeText.textContent = message;
  historyNotice.hidden = false;
  closeHistoryNoticeButton.focus();
}

function closeHistoryNotice() {
  historyNotice.hidden = true;
  historyNoticeText.textContent = "";
}

function openSettings() {
  closeHistory(false);
  closeModelMenu();
  settingsPanel.classList.add("open");
  themeSelect.focus();
}

function closeSettings(restoreFocus = true) {
  settingsPanel.classList.remove("open");
  if (restoreFocus) {
    settingsButton.focus();
  }
}

function openHistory() {
  closeSettings(false);
  closeModelMenu();
  closeHistoryNotice();
  renderHistory();
  historyPanel.classList.add("open");
  newChatButton.focus();
}

function closeHistory(restoreFocus = true) {
  closeHistoryNotice();
  historyPanel.classList.remove("open");
  if (restoreFocus) {
    historyButton.focus();
  }
}

function renderMessages(options = {}) {
  const previousScrollTop = messagesEl.scrollTop;
  messagesEl.innerHTML = "";

  if (settings.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "先在设置的高级模型 API 中保存当前模型的 API Key，然后开始对话。";
    messagesEl.appendChild(empty);
    return;
  }

  const editableMessageIndex = getLatestEditableUserMessageIndex();

  for (const [index, message] of settings.messages.entries()) {
    if (index === editingMessageIndex && message.role === "user") {
      appendEditableUserMessage(message, index);
      continue;
    }

    appendMessage(message.role, message.content, {
      editable: index === editableMessageIndex,
      images: message.images,
      messageIndex: index,
      reasoningContent: message.reasoningContent || ""
    });
  }

  if (options.preserveScroll) {
    messagesEl.scrollTop = previousScrollTop;
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderLatex(value, display = false) {
  const source = value.trim();

  if (!source) {
    return "";
  }

  if (typeof katex !== "undefined" && typeof katex.renderToString === "function") {
    try {
      return katex.renderToString(source, {
        displayMode: display,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml"
      });
    } catch (error) {
      console.warn("KaTeX render failed:", error);
    }
  }

  const className = display ? "katex-fallback katex-display" : "katex-fallback";
  return `<span class="${className}">${escapeHtml(source)}</span>`;
}

function isEscapedAt(value, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function replaceInlineMath(line, addMathToken) {
  let result = "";
  let index = 0;

  while (index < line.length) {
    if (line[index] === "`") {
      const marker = line.slice(index).match(/^`+/)?.[0] || "`";
      const closingIndex = line.indexOf(marker, index + marker.length);
      if (closingIndex === -1) {
        result += line.slice(index);
        break;
      }

      result += line.slice(index, closingIndex + marker.length);
      index = closingIndex + marker.length;
      continue;
    }

    if (line.startsWith("\\(", index) && !isEscapedAt(line, index)) {
      const closingIndex = line.indexOf("\\)", index + 2);
      if (closingIndex !== -1) {
        result += addMathToken(line.slice(index + 2, closingIndex), false);
        index = closingIndex + 2;
        continue;
      }
    }

    if (line[index] === "$" && line[index + 1] !== "$" && !isEscapedAt(line, index)) {
      let closingIndex = index + 1;
      while (closingIndex < line.length) {
        if (line[closingIndex] === "$" && !isEscapedAt(line, closingIndex)) {
          break;
        }
        closingIndex += 1;
      }

      if (closingIndex < line.length) {
        const source = line.slice(index + 1, closingIndex);
        if (source.trim() && !/^\s|\s$/.test(source) && !/\d/.test(line[closingIndex + 1] || "")) {
          result += addMathToken(source, false);
          index = closingIndex + 1;
          continue;
        }
      }
    }

    result += line[index];
    index += 1;
  }

  return result;
}

function extractLatex(markdown) {
  const tokens = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let inCodeFence = false;
  let codeFenceMarker = "";

  function addMathToken(source, display) {
    const placeholder = `@@EDGE_CHAT_MATH_${tokens.length}@@`;
    tokens.push({
      placeholder,
      html: renderLatex(source, display)
    });
    return display ? `<div>${placeholder}</div>` : placeholder;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^(\s*)(`{3,}|~{3,})/);

    if (fence) {
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceMarker = fence[2][0];
      } else if (fence[2][0] === codeFenceMarker) {
        inCodeFence = false;
        codeFenceMarker = "";
      }

      output.push(line);
      continue;
    }

    if (inCodeFence) {
      output.push(line);
      continue;
    }

    const displayMathStart = line.match(/^\s*(\$\$|\\\[)(.*)$/);
    if (displayMathStart) {
      const closingToken = displayMathStart[1] === "$$" ? "$$" : "\\]";
      const mathLines = [];
      let firstLine = displayMathStart[2];
      let closingIndex = firstLine.indexOf(closingToken);

      if (closingIndex !== -1) {
        output.push(addMathToken(firstLine.slice(0, closingIndex), true));
        continue;
      }

      if (firstLine.trim()) {
        mathLines.push(firstLine);
      }

      index += 1;

      while (index < lines.length) {
        closingIndex = lines[index].indexOf(closingToken);

        if (closingIndex !== -1) {
          mathLines.push(lines[index].slice(0, closingIndex));
          break;
        }

        mathLines.push(lines[index]);
        index += 1;
      }

      output.push(addMathToken(mathLines.join("\n"), true));
      continue;
    }

    output.push(replaceInlineMath(line, addMathToken));
  }

  return {
    markdown: output.join("\n"),
    tokens
  };
}

function restoreLatexTokens(html, tokens) {
  return tokens.reduce(
    (nextHtml, token) => nextHtml.replaceAll(token.placeholder, token.html),
    html
  );
}

function sanitizeMarkdownHtml(html) {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"]
  });
}

function decorateRenderedLinks(html) {
  const template = document.createElement("template");
  template.innerHTML = html;

  for (const link of template.content.querySelectorAll("a[href]")) {
    link.target = "_blank";
    link.rel = "noreferrer";
  }

  return template.innerHTML;
}

function renderMarkdown(markdown) {
  const source = typeof markdown === "string" ? markdown : "";
  const { markdown: markdownWithMathTokens, tokens } = extractLatex(source);

  if (
    typeof marked === "undefined" ||
    typeof marked.parse !== "function" ||
    typeof DOMPurify === "undefined" ||
    typeof DOMPurify.sanitize !== "function"
  ) {
    const escaped = escapeHtml(markdownWithMathTokens).replace(/\n/g, "<br>");
    return restoreLatexTokens(escaped, tokens);
  }

  const rawHtml = marked.parse(markdownWithMathTokens, {
    async: false,
    breaks: false,
    gfm: true
  });
  const htmlWithLatex = restoreLatexTokens(rawHtml, tokens);
  const sanitizedHtml = sanitizeMarkdownHtml(htmlWithLatex);
  return decorateRenderedLinks(sanitizedHtml);
}

function renderMessageImages(images) {
  const normalizedImages = normalizeImageAttachments(images);
  if (normalizedImages.length === 0) {
    return null;
  }

  const list = document.createElement("div");
  list.className = "message-images";

  for (const image of normalizedImages) {
    const img = document.createElement("img");
    img.className = "message-image";
    img.src = image.dataUrl;
    img.alt = image.name || "用户粘贴的图片";
    img.loading = "lazy";
    list.appendChild(img);
  }

  return list;
}

function setMessageContent(element, role, content, options = {}) {
  if (role === "assistant") {
    element.innerHTML = renderMarkdown(content);
    return;
  }

  element.textContent = content;
  const images = renderMessageImages(options.images);
  if (images) {
    element.appendChild(images);
  }
}

function createUserMessageActions(messageIndex) {
  const actions = document.createElement("div");
  actions.className = "message-actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "message-edit";
  editButton.dataset.messageIndex = String(messageIndex);
  editButton.setAttribute("aria-label", "编辑并重新发送这条消息");
  editButton.setAttribute("title", "编辑并重新发送");
  editButton.textContent = "✎";

  actions.appendChild(editButton);
  return actions;
}

function appendEditableUserMessage(message, messageIndex) {
  const wrapper = document.createElement("article");
  wrapper.className = "message user editing";

  const form = document.createElement("form");
  form.className = "message-edit-form";
  form.dataset.messageIndex = String(messageIndex);

  const textarea = document.createElement("textarea");
  textarea.className = "message-edit-input";
  textarea.value = getMessageText(message);
  textarea.rows = Math.min(8, Math.max(2, textarea.value.split(/\r?\n/).length));
  textarea.setAttribute("aria-label", "编辑消息内容");

  const images = renderMessageImages(message.images);

  const actions = document.createElement("div");
  actions.className = "message-edit-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "message-edit-cancel";
  cancelButton.textContent = "取消";

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "message-edit-submit";
  saveButton.textContent = "重新发送";

  actions.append(cancelButton, saveButton);
  form.appendChild(textarea);
  if (images) {
    form.appendChild(images);
  }
  form.appendChild(actions);

  wrapper.appendChild(form);
  messagesEl.appendChild(wrapper);
  try {
    textarea.focus({ preventScroll: true });
  } catch {
    textarea.focus();
  }
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function isMessagesNearBottom() {
  const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  return distanceFromBottom <= 24;
}

function scrollMessagesToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function createAssistantMessageControls(content = "", reasoningContent = "", streaming = false) {
  const body = document.createElement("div");
  body.className = "message-content assistant-content";

  const reasoning = document.createElement("details");
  reasoning.className = "reasoning";

  const summary = document.createElement("summary");
  summary.textContent = streaming ? "思考中..." : "思考过程";

  const reasoningBody = document.createElement("div");
  reasoningBody.className = "reasoning-content";

  const answer = document.createElement("div");
  answer.className = "assistant-answer";

  reasoning.append(summary, reasoningBody);
  body.append(reasoning, answer);

  function updateReasoning(nextReasoningContent) {
    reasoningBody.textContent = nextReasoningContent;
    reasoning.hidden = !nextReasoningContent;
  }

  function updateContent(nextContent) {
    if (nextContent) {
      answer.innerHTML = renderMarkdown(nextContent);
      return;
    }

    answer.textContent = streaming ? "正在思考..." : "";
  }

  function finish() {
    summary.textContent = "思考过程";
  }

  updateReasoning(reasoningContent);
  updateContent(content);

  if (!streaming) {
    finish();
  }

  return {
    body,
    updateReasoning,
    updateContent,
    finish
  };
}

function appendMessage(role, content, options = {}) {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${role}`;

  if (role === "assistant") {
    const controls = createAssistantMessageControls(content, options.reasoningContent || "", Boolean(options.streaming));
    wrapper.appendChild(controls.body);
    messagesEl.appendChild(wrapper);
    scrollMessagesToBottom();
    return controls;
  }

  const body = document.createElement("div");
  body.className = "message-content";
  setMessageContent(body, role, content, options);
  wrapper.appendChild(body);

  if (role === "user" && options.editable) {
    wrapper.appendChild(createUserMessageActions(options.messageIndex));
  }

  messagesEl.appendChild(wrapper);
  scrollMessagesToBottom();
  return body;
}

function buildApiMessage(message, provider, config) {
  const content = getMessageText(message);
  const images = normalizeImageAttachments(message.images);

  if (message.role === "user" && images.length > 0 && isMimoMultimodalConfig(provider, config)) {
    return {
      role: message.role,
      content: [
        { type: "text", text: content.trim() || DEFAULT_IMAGE_PROMPT },
        ...images.map((image) => ({
          type: "image_url",
          image_url: {
            url: image.dataUrl
          }
        }))
      ]
    };
  }

  return {
    role: message.role,
    content
  };
}

function buildApiMessages(
  messages = settings.messages,
  includeSystemPrompt = true,
  provider = getActiveProvider(),
  config = getActiveProviderConfig()
) {
  const apiMessages = messages.map((message) => buildApiMessage(message, provider, config));

  if (includeSystemPrompt && settings.systemPrompt.trim()) {
    return [
      { role: "system", content: settings.systemPrompt.trim() },
      ...apiMessages
    ];
  }

  return apiMessages;
}

async function saveMessages() {
  await saveCurrentSession();
}

async function loadSettings() {
  const data = await storageGet(Object.values(STORAGE_KEYS));
  const sessions = normalizeSessions(data[STORAGE_KEYS.sessions], data[STORAGE_KEYS.messages]);
  const currentSessionId = sessions.some((session) => session.id === data[STORAGE_KEYS.currentSessionId])
    ? data[STORAGE_KEYS.currentSessionId]
    : sessions[0].id;
  const activeProvider = MODEL_PROVIDERS[data[STORAGE_KEYS.activeProvider]]
    ? data[STORAGE_KEYS.activeProvider]
    : DEFAULT_PROVIDER_ID;
  const providerConfigs = normalizeProviderConfigs(
    data[STORAGE_KEYS.providerConfigs],
    data[STORAGE_KEYS.legacyApiKey] || "",
    data[STORAGE_KEYS.legacyModel] || ""
  );

  settings = {
    activeProvider,
    providerConfigs,
    mimoWebSearchMode: normalizeMimoWebSearchMode(data[STORAGE_KEYS.mimoWebSearchMode]),
    theme: data[STORAGE_KEYS.theme] || DEFAULT_THEME,
    systemPrompt: data[STORAGE_KEYS.systemPrompt] || "",
    messages: [],
    sessions,
    currentSessionId
  };

  syncCurrentSessionMessages();

  deepseekApiKeyInput.value = settings.providerConfigs.deepseek.apiKey;
  deepseekEndpointInput.value = settings.providerConfigs.deepseek.apiUrl;
  mimoApiKeyInput.value = settings.providerConfigs.mimo.apiKey;
  mimoEndpointInput.value = settings.providerConfigs.mimo.apiUrl;
  themeSelect.value = settings.theme;
  systemPromptInput.value = settings.systemPrompt;
  mimoWebSearchModeSelect.value = settings.mimoWebSearchMode;
  applyTheme(settings.theme);
  updateModelSwitchLabel();
  updateTokenUsageDisplay();
  await Promise.all([
    saveSessions(),
    storageSet({
      [STORAGE_KEYS.activeProvider]: settings.activeProvider,
      [STORAGE_KEYS.providerConfigs]: settings.providerConfigs,
      [STORAGE_KEYS.mimoWebSearchMode]: settings.mimoWebSearchMode
    })
  ]);
  renderMessages();
}

function parseStreamErrorText(text, status) {
  try {
    const payload = JSON.parse(text);
    return payload.error?.message || payload.message || `请求失败，状态码 ${status}`;
  } catch {
    return text || `请求失败，状态码 ${status}`;
  }
}

function buildProviderRequestBody(provider, config, options = {}) {
  const stream = options.stream !== false;
  const body = {
    model: config.model,
    messages: buildApiMessages(
      options.messages || settings.messages,
      options.includeSystemPrompt !== false,
      provider,
      config
    ),
    stream
  };

  if (stream && provider.includeStreamUsage) {
    body.stream_options = {
      include_usage: true
    };
  }

  if (provider.supportsThinking) {
    body.thinking = {
      type: "enabled"
    };
  }

  if (options.maxTokens) {
    body.max_tokens = options.maxTokens;
  }

  if (provider.id === "mimo" && options.includeWebSearch !== false && settings.mimoWebSearchMode !== "off") {
    body.tools = [
      {
        type: "web_search",
        max_keyword: 3,
        force_search: settings.mimoWebSearchMode === "force",
        limit: 1
      }
    ];
  }

  return body;
}

function buildAuthHeaders(provider, config) {
  return provider.authHeader === "api-key"
    ? { "api-key": config.apiKey }
    : { "Authorization": `Bearer ${config.apiKey}` };
}

async function callModelStream(onDelta) {
  const provider = getActiveProvider();
  const config = getActiveProviderConfig();
  const authHeaders = buildAuthHeaders(provider, config);
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildProviderRequestBody(provider, config))
  });

  if (!response.ok) {
    throw new Error(parseStreamErrorText(await response.text(), response.status));
  }

  if (!response.body) {
    throw new Error(provider.streamUnsupportedMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoningContent = "";
  let usage = null;

  function handleEventData(data) {
    const value = data.trim();

    if (!value) {
      return false;
    }

    if (value === "[DONE]") {
      return true;
    }

    let payload;

    try {
      payload = JSON.parse(value);
    } catch {
      throw new Error(provider.parseErrorMessage);
    }

    if (payload.usage) {
      usage = normalizeUsage(payload.usage);
    }

    const delta = payload.choices?.[0]?.delta || {};
    const nextReasoning = delta.reasoning_content || "";
    const nextContent = delta.content || "";

    if (nextReasoning) {
      reasoningContent += nextReasoning;
    }

    if (nextContent) {
      content += nextContent;
    }

    if (nextReasoning || nextContent) {
      onDelta({
        content,
        reasoningContent
      });
    }

    return false;
  }

  function processBuffer() {
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";

    for (const event of events) {
      const dataLines = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());

      if (dataLines.length > 0 && handleEventData(dataLines.join("\n"))) {
        return true;
      }
    }

    return false;
  }

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    if (processBuffer()) {
      await reader.cancel();
      break;
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    const event = buffer;
    buffer = "";
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length > 0) {
      handleEventData(dataLines.join("\n"));
    }
  }

  if (!content) {
    throw new Error(provider.emptyResponseMessage);
  }

  return {
    content,
    reasoningContent,
    usage
  };
}

async function callModelOnce(messages, options = {}) {
  const provider = getActiveProvider();
  const config = getActiveProviderConfig();
  const authHeaders = buildAuthHeaders(provider, config);
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildProviderRequestBody(provider, config, {
      messages,
      stream: false,
      includeSystemPrompt: false,
      includeWebSearch: false,
      maxTokens: options.maxTokens
    }))
  });

  if (!response.ok) {
    throw new Error(parseStreamErrorText(await response.text(), response.status));
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content?.trim()
    || payload.choices?.[0]?.text?.trim()
    || "";

  if (!content) {
    throw new Error(provider.emptyResponseMessage);
  }

  return {
    content,
    usage: normalizeUsage(payload.usage)
  };
}

function serializeMessagesForSummary(messages) {
  return messages
    .map((message, index) => {
      const roleLabel = {
        system: "系统",
        user: "用户",
        assistant: "助手"
      }[message.role] || message.role;

      const imageCount = normalizeImageAttachments(message.images).length;
      const imageNote = imageCount > 0 ? `（包含 ${imageCount} 张图片）` : "";
      return `${index + 1}. ${roleLabel}：${message.content || ""}${imageNote}`;
    })
    .join("\n\n");
}

async function summarizeSessionMessages(session) {
  const summaryPrompt = [
    "你负责压缩一段历史对话上下文。",
    "请保留用户目标、关键事实、约束、已做决定、未解决问题。",
    "删除寒暄、重复内容、格式噪声。",
    "输出中文，控制在 800 字以内。"
  ].join("\n");
  const transcript = serializeMessagesForSummary(session.messages);
  const reply = await callModelOnce([
    { role: "system", content: summaryPrompt },
    { role: "user", content: `请压缩以下对话：\n\n${transcript}` }
  ], {
    maxTokens: 1000
  });

  return reply.content;
}

async function compressSessionContext(sessionId, button) {
  const session = settings.sessions.find((item) => item.id === sessionId);
  if (!session) return;

  if (session.messages.length < 10) {
    showHistoryNotice("当前对话内容较少，无需压缩");
    return;
  }

  const provider = getActiveProvider();
  const providerConfig = getActiveProviderConfig();
  if (!providerConfig.apiKey) {
    openSettings();
    appendMessage("system", `请先配置当前模型 ${provider.label} API Key。`);
    return;
  }

  const originalAriaLabel = button.getAttribute("aria-label");
  const originalTitle = button.getAttribute("title");
  button.disabled = true;
  button.classList.add("loading");
  button.setAttribute("aria-label", `正在压缩 ${session.title || "新对话"} 的上下文`);
  button.setAttribute("title", "压缩中");

  try {
    const summary = await summarizeSessionMessages(session);
    const recentMessages = session.messages.slice(-8);
    session.messages = [
      {
        role: "system",
        content: `以下为已压缩的历史上下文摘要：\n${summary.trim()}`
      },
      ...recentMessages
    ];
    session.title = buildSessionTitle(session.messages);
    session.updatedAt = Date.now();

    if (session.id === settings.currentSessionId) {
      settings.messages = session.messages;
    }

    await saveSessions();

    if (session.id === settings.currentSessionId) {
      renderMessages();
      updateTokenUsageDisplay();
    }

    renderHistory();
    appendMessage("system", "上下文压缩完成");
  } catch (error) {
    appendMessage("system", `上下文压缩失败：${error.message}`);
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.classList.remove("loading");
      if (originalAriaLabel) {
        button.setAttribute("aria-label", originalAriaLabel);
      }
      if (originalTitle) {
        button.setAttribute("title", originalTitle);
      }
    }
  }
}

function renderPendingImages() {
  pendingImagesEl.innerHTML = "";
  pendingImagesEl.hidden = pendingImages.length === 0;

  if (pendingImages.length > 0) {
    const currentHeight = chatForm.getBoundingClientRect().height;
    if (currentHeight < COMPOSER_IMAGE_MIN_HEIGHT) {
      document.documentElement.style.setProperty("--composer-height", `${COMPOSER_IMAGE_MIN_HEIGHT}px`);
    }
  } else if (document.documentElement.style.getPropertyValue("--composer-height") === `${COMPOSER_IMAGE_MIN_HEIGHT}px`) {
    document.documentElement.style.setProperty("--composer-height", `${COMPOSER_MIN_HEIGHT}px`);
  }

  for (const image of pendingImages) {
    const item = document.createElement("div");
    item.className = "pending-image";

    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.name || "待发送图片";
    img.title = `${image.name || "待发送图片"} · ${formatFileSize(image.size)}`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "pending-image-remove";
    removeButton.dataset.imageId = image.id;
    removeButton.setAttribute("aria-label", "移除图片");
    removeButton.setAttribute("title", "移除图片");
    removeButton.textContent = "×";

    item.append(img, removeButton);
    pendingImagesEl.appendChild(item);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error || new Error("图片读取失败")));
    reader.readAsDataURL(file);
  });
}

async function addClipboardImages(files) {
  const acceptedFiles = [];

  for (const file of files) {
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(file.type)) {
      appendMessage("system", "仅支持粘贴 PNG、JPEG 或 WebP 图片。");
      continue;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      appendMessage("system", `图片 ${file.name || "clipboard-image"} 超过 5MB，已跳过。`);
      continue;
    }

    if (pendingImages.length + acceptedFiles.length >= MAX_IMAGES_PER_MESSAGE) {
      appendMessage("system", `每条消息最多粘贴 ${MAX_IMAGES_PER_MESSAGE} 张图片。`);
      break;
    }

    acceptedFiles.push(file);
  }

  if (acceptedFiles.length === 0) {
    return;
  }

  try {
    const nextImages = await Promise.all(acceptedFiles.map(async (file, index) => ({
      id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${index}`,
      name: file.name || "clipboard-image",
      mimeType: file.type,
      size: file.size,
      dataUrl: await readFileAsDataUrl(file)
    })));

    pendingImages = normalizeImageAttachments([...pendingImages, ...nextImages]);
    renderPendingImages();
  } catch (error) {
    appendMessage("system", `读取粘贴图片失败：${error.message}`);
  }
}

function validateOutgoingMessage(images) {
  const provider = getActiveProvider();
  const providerConfig = getActiveProviderConfig();

  if (images.length > 0 && !isMimoMultimodalConfig(provider, providerConfig)) {
    appendMessage("system", `粘贴图片仅支持小米 MiMo 的 ${MIMO_MULTIMODAL_MODEL} 模型，请切换模型后再发送。`);
    return false;
  }

  if (!providerConfig.apiKey) {
    openSettings();
    appendMessage("system", `请先在高级模型 API 中保存 ${provider.label} API Key。`);
    return false;
  }

  return true;
}

async function requestReplyForCurrentMessages() {
  let errorMessage = "";

  isRequestInFlight = true;
  renderMessages();

  const assistantMessage = appendMessage("assistant", "", { streaming: true });
  sendButton.disabled = true;
  closeModelMenu();
  modelSwitchButton.disabled = true;
  updateModelSwitchLabel("请求中");

  try {
    const reply = await callModelStream(({ content: replyContent, reasoningContent }) => {
      const shouldFollowOutput = isMessagesNearBottom();
      assistantMessage.updateReasoning(reasoningContent);
      assistantMessage.updateContent(replyContent);

      if (shouldFollowOutput) {
        scrollMessagesToBottom();
      }
    });

    const shouldFollowOutput = isMessagesNearBottom();
    assistantMessage.finish();
    assistantMessage.updateContent(reply.content);
    if (shouldFollowOutput) {
      scrollMessagesToBottom();
    }
    settings.messages.push({
      role: "assistant",
      content: reply.content,
      reasoningContent: reply.reasoningContent,
      usage: reply.usage
    });
    await saveMessages();
    updateModelSwitchLabel();
    updateTokenUsageDisplay(reply.usage);
  } catch (error) {
    errorMessage = `请求失败：${error.message}`;
    updateModelSwitchLabel("请求失败");
  } finally {
    isRequestInFlight = false;
    sendButton.disabled = false;
    modelSwitchButton.disabled = false;
    renderMessages();
    if (errorMessage) {
      appendMessage("system", errorMessage);
    }
    messageInput.focus();
  }
}

settingsButton.addEventListener("click", () => {
  if (settingsPanel.classList.contains("open")) {
    closeSettings();
    return;
  }

  openSettings();
});

modelSwitchButton.addEventListener("click", () => {
  toggleModelMenu();
});

modelMenu.addEventListener("click", async (event) => {
  const option = event.target.closest(".model-menu-option");
  if (!option) return;

  const providerId = option.dataset.providerId;
  const model = option.dataset.model;

  if (!MODEL_PROVIDERS[providerId] || !MODEL_PROVIDERS[providerId].models.includes(model)) {
    return;
  }

  settings.activeProvider = providerId;
  settings.providerConfigs = normalizeProviderConfigs({
    ...settings.providerConfigs,
    [providerId]: {
      ...getActiveProviderConfig(),
      model
    }
  });

  await storageSet({
    [STORAGE_KEYS.activeProvider]: settings.activeProvider,
    [STORAGE_KEYS.providerConfigs]: settings.providerConfigs
  });

  updateModelSwitchLabel();
  closeModelMenu();
  messageInput.focus();
});

document.addEventListener("click", (event) => {
  if (
    modelMenu.hidden ||
    modelMenu.contains(event.target) ||
    modelSwitchButton.contains(event.target)
  ) {
    return;
  }

  closeModelMenu();
});

historyButton.addEventListener("click", () => {
  if (historyPanel.classList.contains("open")) {
    closeHistory();
    return;
  }

  openHistory();
});

closeSettingsButton.addEventListener("click", () => {
  closeSettings();
});

closeHistoryButton.addEventListener("click", () => {
  closeHistory();
});

closeHistoryNoticeButton.addEventListener("click", () => {
  closeHistoryNotice();
});

historyNotice.addEventListener("click", (event) => {
  if (event.target === historyNotice) {
    closeHistoryNotice();
  }
});

settingsPanel.addEventListener("click", (event) => {
  if (event.target === settingsPanel) {
    closeSettings();
  }
});

historyPanel.addEventListener("click", (event) => {
  if (event.target === historyPanel) {
    closeHistory();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modelMenu.hidden) {
    closeModelMenu();
    modelSwitchButton.focus();
  }

  if (event.key === "Escape" && !historyNotice.hidden) {
    closeHistoryNotice();
    return;
  }

  if (event.key === "Escape" && settingsPanel.classList.contains("open")) {
    closeSettings();
  }

  if (event.key === "Escape" && historyPanel.classList.contains("open")) {
    closeHistory();
  }
});

newChatButton.addEventListener("click", async () => {
  const session = createSession();
  settings.sessions.unshift(session);
  settings.currentSessionId = session.id;
  settings.messages = session.messages;
  await saveSessions();
  renderMessages();
  updateTokenUsageDisplay();
  renderHistory();
  closeHistory();
  messageInput.focus();
});

historyList.addEventListener("click", async (event) => {
  const selectButton = event.target.closest(".history-select");
  const compressButton = event.target.closest(".history-compress");
  const deleteButton = event.target.closest(".history-delete");

  if (selectButton) {
    const session = settings.sessions.find((item) => item.id === selectButton.dataset.sessionId);
    if (!session) return;

    settings.currentSessionId = session.id;
    settings.messages = session.messages;
    await saveSessions();
    renderMessages();
    updateTokenUsageDisplay();
    closeHistory();
    messageInput.focus();
    return;
  }

  if (compressButton) {
    await compressSessionContext(compressButton.dataset.sessionId, compressButton);
    return;
  }

  if (!deleteButton) return;

  const sessionId = deleteButton.dataset.sessionId;
  settings.sessions = settings.sessions.filter((session) => session.id !== sessionId);

  if (settings.sessions.length === 0) {
    const session = createSession();
    settings.sessions = [session];
    settings.currentSessionId = session.id;
  } else if (settings.currentSessionId === sessionId) {
    settings.currentSessionId = settings.sessions[0].id;
  }

  syncCurrentSessionMessages();
  await saveSessions();
  renderMessages();
  updateTokenUsageDisplay();
  renderHistory();
});

saveSettingsButton.addEventListener("click", async () => {
  settings.providerConfigs = normalizeProviderConfigs({
    deepseek: {
      apiKey: deepseekApiKeyInput.value.trim(),
      apiUrl: deepseekEndpointInput.value.trim(),
      model: settings.providerConfigs.deepseek.model
    },
    mimo: {
      apiKey: mimoApiKeyInput.value.trim(),
      apiUrl: mimoEndpointInput.value.trim(),
      model: settings.providerConfigs.mimo.model
    }
  });
  settings.theme = themeSelect.value;
  settings.systemPrompt = systemPromptInput.value.trim();
  settings.mimoWebSearchMode = normalizeMimoWebSearchMode(mimoWebSearchModeSelect.value);

  await storageSet({
    [STORAGE_KEYS.providerConfigs]: settings.providerConfigs,
    [STORAGE_KEYS.theme]: settings.theme,
    [STORAGE_KEYS.systemPrompt]: settings.systemPrompt,
    [STORAGE_KEYS.mimoWebSearchMode]: settings.mimoWebSearchMode
  });

  applyTheme(settings.theme);
  updateModelSwitchLabel();
  updateTokenUsageDisplay();
  closeSettings();
});

clearChatButton.addEventListener("click", async () => {
  const confirmed = window.confirm("确定要重置设置吗？API Key、Endpoint、主题、系统提示词、联网搜索和模型选择会恢复默认，历史对话会保留。");
  if (!confirmed) return;

  settings.activeProvider = DEFAULT_PROVIDER_ID;
  settings.providerConfigs = createDefaultProviderConfigs();
  settings.theme = DEFAULT_THEME;
  settings.systemPrompt = "";
  settings.mimoWebSearchMode = DEFAULT_MIMO_WEB_SEARCH_MODE;

  deepseekApiKeyInput.value = settings.providerConfigs.deepseek.apiKey;
  deepseekEndpointInput.value = settings.providerConfigs.deepseek.apiUrl;
  mimoApiKeyInput.value = settings.providerConfigs.mimo.apiKey;
  mimoEndpointInput.value = settings.providerConfigs.mimo.apiUrl;
  themeSelect.value = settings.theme;
  systemPromptInput.value = settings.systemPrompt;
  mimoWebSearchModeSelect.value = settings.mimoWebSearchMode;

  await storageSet({
    [STORAGE_KEYS.activeProvider]: settings.activeProvider,
    [STORAGE_KEYS.providerConfigs]: settings.providerConfigs,
    [STORAGE_KEYS.theme]: settings.theme,
    [STORAGE_KEYS.systemPrompt]: settings.systemPrompt,
    [STORAGE_KEYS.mimoWebSearchMode]: settings.mimoWebSearchMode
  });

  applyTheme(settings.theme);
  updateModelSwitchLabel();
  updateTokenUsageDisplay();
  renderModelMenu();
});

composerResizeHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;

  const startY = event.clientY;
  const startHeight = chatForm.getBoundingClientRect().height;

  composerResizeHandle.setPointerCapture(event.pointerId);
  document.body.classList.add("composer-resizing");
  event.preventDefault();

  const resizeComposer = (pointerEvent) => {
    const minHeight = getComposerMinHeight();
    const maxHeight = Math.max(
      minHeight,
      window.innerHeight - COMPOSER_MAX_MARGIN
    );
    const nextHeight = Math.min(
      maxHeight,
      Math.max(minHeight, startHeight + startY - pointerEvent.clientY)
    );

    document.documentElement.style.setProperty(
      "--composer-height",
      `${Math.round(nextHeight)}px`
    );
  };

  const stopResizing = (pointerEvent) => {
    document.body.classList.remove("composer-resizing");
    if (composerResizeHandle.hasPointerCapture(pointerEvent.pointerId)) {
      composerResizeHandle.releasePointerCapture(pointerEvent.pointerId);
    }
    composerResizeHandle.removeEventListener("pointermove", resizeComposer);
    composerResizeHandle.removeEventListener("pointerup", stopResizing);
    composerResizeHandle.removeEventListener("pointercancel", stopResizing);
  };

  composerResizeHandle.addEventListener("pointermove", resizeComposer);
  composerResizeHandle.addEventListener("pointerup", stopResizing);
  composerResizeHandle.addEventListener("pointercancel", stopResizing);
});

messagesEl.addEventListener("click", (event) => {
  const editButton = event.target.closest(".message-edit");
  if (!editButton) return;

  const messageIndex = Number(editButton.dataset.messageIndex);
  if (messageIndex !== getLatestEditableUserMessageIndex()) {
    return;
  }

  editingMessageIndex = messageIndex;
  renderMessages({ preserveScroll: true });
});

messagesEl.addEventListener("click", (event) => {
  const cancelButton = event.target.closest(".message-edit-cancel");
  if (!cancelButton) return;

  editingMessageIndex = -1;
  renderMessages();
});

messagesEl.addEventListener("submit", async (event) => {
  const form = event.target.closest(".message-edit-form");
  if (!form) return;

  event.preventDefault();

  const messageIndex = Number(form.dataset.messageIndex);
  const originalMessage = settings.messages[messageIndex];
  if (messageIndex !== editingMessageIndex || originalMessage?.role !== "user") {
    return;
  }

  const textarea = form.querySelector(".message-edit-input");
  let content = textarea.value.trim();
  const images = normalizeImageAttachments(originalMessage.images);
  if (!content && images.length === 0) {
    return;
  }

  if (!validateOutgoingMessage(images)) {
    return;
  }

  if (!content && images.length > 0) {
    content = DEFAULT_IMAGE_PROMPT;
  }

  settings.messages = [
    ...settings.messages.slice(0, messageIndex),
    { role: "user", content, images }
  ];
  editingMessageIndex = -1;
  await saveMessages();
  updateTokenUsageDisplay();
  await requestReplyForCurrentMessages();
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

messageInput.addEventListener("paste", async (event) => {
  const items = Array.from(event.clipboardData?.items || []);
  const imageFiles = items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);

  if (imageFiles.length === 0) {
    return;
  }

  event.preventDefault();
  await addClipboardImages(imageFiles);
});

pendingImagesEl.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".pending-image-remove");
  if (!removeButton) return;

  pendingImages = pendingImages.filter((image) => image.id !== removeButton.dataset.imageId);
  renderPendingImages();
  messageInput.focus();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  let content = messageInput.value.trim();
  const images = normalizeImageAttachments(pendingImages);
  if (!content && images.length === 0) return;

  if (!validateOutgoingMessage(images)) {
    return;
  }

  if (!content && images.length > 0) {
    content = DEFAULT_IMAGE_PROMPT;
  }

  const userMessage = { role: "user", content, images };
  settings.messages.push(userMessage);
  appendMessage("user", content, { images });
  messageInput.value = "";
  pendingImages = [];
  renderPendingImages();
  await saveMessages();
  await requestReplyForCurrentMessages();
});

loadSettings().catch((error) => {
  updateModelSwitchLabel("初始化失败");
  appendMessage("system", error.message);
});
