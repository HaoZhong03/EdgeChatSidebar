import {
  DEFAULT_PROVIDER_ID,
  MIMO_MULTIMODAL_MODEL,
  buildAuthHeaders,
  buildChatCompletionRequest,
  createDefaultProviderConfigs,
  createStreamAccumulator,
  getProviderProfile,
  getProviderProfiles,
  isExplicitUnknownParameterError,
  normalizeCustomProvider,
  normalizeProviderConfigs,
  normalizeUsage,
  parseApiError
} from "./providers.js";
import {
  PREFERENCE_KEYS,
  clearAllLocalData,
  formatReleasedBytes,
  garbageCollectSecureStore,
  readLegacyStorage,
  readSecureState,
  removeLegacyStorage,
  writeSecureState
} from "./secure-storage.js";

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
const mimoApiKeyInput = document.getElementById("mimoApiKeyInput");
const customProviderIdInput = document.getElementById("customProviderIdInput");
const customProviderNameInput = document.getElementById("customProviderNameInput");
const customProviderEndpointInput = document.getElementById("customProviderEndpointInput");
const customProviderApiKeyInput = document.getElementById("customProviderApiKeyInput");
const customProviderModelsInput = document.getElementById("customProviderModelsInput");
const customProviderList = document.getElementById("customProviderList");
const saveCustomProviderButton = document.getElementById("saveCustomProviderButton");
const cancelCustomProviderButton = document.getElementById("cancelCustomProviderButton");
const customProviderNotice = document.getElementById("customProviderNotice");
const cleanupCacheButton = document.getElementById("cleanupCacheButton");
const clearAllDataButton = document.getElementById("clearAllDataButton");
const storageNotice = document.getElementById("storageNotice");
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
const tokenUsageButton = document.getElementById("tokenUsageButton");
const tokenUsageDetails = document.getElementById("tokenUsageDetails");

const COMPOSER_MIN_HEIGHT = 64;
const COMPOSER_IMAGE_MIN_HEIGHT = 124;
const COMPOSER_MAX_MARGIN = 120;
const DEFAULT_MIMO_WEB_SEARCH_MODE = "off";
const MIMO_WEB_SEARCH_MODES = ["off", "auto", "force"];
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
let MODEL_PROVIDERS = {};
let pendingImages = [];
let isRequestInFlight = false;
let editingMessageIndex = -1;

function refreshProviderRegistry() {
  MODEL_PROVIDERS = Object.fromEntries(getProviderProfiles(settings.providerConfigs).map((profile) => [
    profile.id,
    {
      ...profile,
      models: profile.models.map((model) => model.id),
      defaultModel: profile.model,
      apiUrl: profile.endpoint,
      streamUnsupportedMessage: `当前浏览器不支持读取 ${profile.label} 的流式响应。`,
      emptyResponseMessage: `${profile.label} 没有返回可显示的内容。`
    }
  ]));
}

function storageGet(keys) {
  return globalThis.chrome?.storage?.local ? chrome.storage.local.get(keys) : Promise.resolve({});
}

function storageSet(value) {
  return globalThis.chrome?.storage?.local ? chrome.storage.local.set(value) : Promise.resolve();
}

async function persistPreferences() {
  const activeConfig = settings.providerConfigs[settings.activeProvider];
  await storageSet({
    [PREFERENCE_KEYS.theme]: settings.theme,
    [PREFERENCE_KEYS.activeProvider]: settings.activeProvider,
    [PREFERENCE_KEYS.activeModel]: activeConfig?.model || "",
    [PREFERENCE_KEYS.mimoWebSearchMode]: settings.mimoWebSearchMode,
    [PREFERENCE_KEYS.schemaVersion]: 1
  });
}

async function persistSecureState() {
  await writeSecureState({
    config: {
      providerConfigs: settings.providerConfigs,
      systemPrompt: settings.systemPrompt
    },
    sessions: settings.sessions,
    currentSessionId: settings.currentSessionId
  });
}

refreshProviderRegistry();

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
  const connection = config.apiKey || provider.type === "custom" ? "已连接" : "未配置";
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

      option.append(modelText);
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

function getLatestTokenUsage() {
  const session = getCurrentSession();
  if (session.contextUsage) return normalizeUsage(session.contextUsage, session.contextUsage);
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const usage = normalizeUsage(session.messages[index]?.usage, session.messages[index]?.usage);
    if (usage) return usage;
  }
  return null;
}

function updateTokenUsageDisplay(usage = getLatestTokenUsage()) {
  const session = getCurrentSession();
  const state = session.contextUsageState || usage?.state || "empty";
  tokenUsageDetails.hidden = true;
  tokenUsageButton.setAttribute("aria-expanded", "false");

  if (state === "unavailable") {
    tokenUsageButton.hidden = false;
    tokenUsageText.textContent = "此模型未返回用量";
    tokenUsageDetails.innerHTML = "";
    return;
  }

  if (!Number.isFinite(usage?.promptTokens)) {
    tokenUsageButton.hidden = true;
    tokenUsageText.textContent = "";
    tokenUsageDetails.innerHTML = "";
    return;
  }

  tokenUsageButton.hidden = false;
  tokenUsageText.textContent = `${formatTokenCount(usage.totalTokens)} tokens`;
  const details = [
    ["输入 / 上下文", usage.promptTokens, "tokens"],
    ["推理", usage.reasoningTokens, "tokens"],
    ["输出", usage.completionTokens, "tokens"],
    ["总量", usage.totalTokens, "tokens"]
  ].filter(([, value]) => Number.isFinite(value));
  tokenUsageDetails.innerHTML = details.map(([label, value, unit]) => (
    `<div class="token-usage-details-row"><span>${label}</span><strong>${formatTokenCount(value)} ${unit}</strong></div>`
  )).join("");
}

function markCurrentUsageStale() {
  const session = getCurrentSession();
  if (session.messages.length === 0) {
    session.contextUsage = null;
    session.contextUsageState = "empty";
  } else {
    session.contextUsageState = "stale";
  }
  updateTokenUsageDisplay();
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
    .map((image) => ({
      id: typeof image.id === "string" && image.id ? image.id : `image-${crypto.randomUUID()}`,
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
    contextUsage: null,
    contextUsageState: "empty",
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
  const normalized = Array.isArray(value)
    ? value
        .filter((session) => session && typeof session.id === "string")
        .map((session) => {
          const messages = Array.isArray(session.messages) ? session.messages.map(normalizeMessage) : [];
          const contextUsage = normalizeUsage(session.contextUsage, session.contextUsage)
            || [...messages].reverse().map((message) => normalizeUsage(message?.usage, message?.usage)).find(Boolean)
            || null;
          const inferredState = messages.length === 0
            ? "empty"
            : (Number.isFinite(contextUsage?.promptTokens) ? "measured" : "unavailable");
          return {
            id: session.id,
            title: session.title || buildSessionTitle(messages),
            messages,
            contextUsage,
            contextUsageState: ["measured", "stale", "unavailable", "empty"].includes(session.contextUsageState)
              ? session.contextUsageState
              : inferredState,
            createdAt: Number.isFinite(session.createdAt) ? session.createdAt : Date.now(),
            updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : Date.now()
          };
        })
    : [];
  const sessions = [...new Map(normalized.map((session) => [session.id, session])).values()];

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
  await persistSecureState();
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

function showSettingsNotice(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function clearCustomProviderForm() {
  customProviderIdInput.value = "";
  customProviderNameInput.value = "";
  customProviderEndpointInput.value = "";
  customProviderApiKeyInput.value = "";
  customProviderModelsInput.value = "";
  saveCustomProviderButton.textContent = "添加提供商";
  cancelCustomProviderButton.hidden = true;
  showSettingsNotice(customProviderNotice, "");
}

function renderCustomProviderList() {
  customProviderList.innerHTML = "";
  const providers = Object.values(settings.providerConfigs).filter((config) => config.type === "custom");
  if (providers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "settings-help";
    empty.textContent = "尚未添加自定义提供商。";
    customProviderList.appendChild(empty);
    return;
  }

  for (const provider of providers) {
    const item = document.createElement("div");
    item.className = "custom-provider-item";
    const summary = document.createElement("div");
    summary.className = "custom-provider-summary";
    const name = document.createElement("span");
    name.className = "custom-provider-name";
    name.textContent = `${provider.label} · ${provider.models.length} 个模型`;
    const endpoint = document.createElement("span");
    endpoint.className = "custom-provider-endpoint";
    endpoint.textContent = provider.endpoint;
    endpoint.title = provider.endpoint;
    summary.append(name, endpoint);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "custom-provider-edit";
    editButton.dataset.providerId = provider.id;
    editButton.textContent = "编辑";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "custom-provider-delete";
    deleteButton.dataset.providerId = provider.id;
    deleteButton.textContent = "删除";
    item.append(summary, editButton, deleteButton);
    customProviderList.appendChild(item);
  }
}

async function removeOriginPermissionIfUnused(permissionOrigin) {
  if (!permissionOrigin || !globalThis.chrome?.permissions) return;
  const stillUsed = Object.values(settings.providerConfigs).some((config) => (
    config.type === "custom" && config.permissionOrigin === permissionOrigin
  ));
  if (!stillUsed) await chrome.permissions.remove({ origins: [permissionOrigin] });
}

function openSettings() {
  closeHistory(false);
  closeModelMenu();
  deepseekApiKeyInput.value = settings.providerConfigs.deepseek.apiKey;
  mimoApiKeyInput.value = settings.providerConfigs.mimo.apiKey;
  systemPromptInput.value = settings.systemPrompt;
  renderCustomProviderList();
  settingsPanel.classList.add("open");
  themeSelect.focus();
}

function closeSettings(restoreFocus = true) {
  settingsPanel.classList.remove("open");
  deepseekApiKeyInput.value = "";
  mimoApiKeyInput.value = "";
  clearCustomProviderForm();
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

async function saveMessages() {
  await saveCurrentSession();
}

async function loadSettings() {
  const preferenceData = await storageGet(Object.values(PREFERENCE_KEYS));
  const legacyData = await readLegacyStorage();
  let secureState = await readSecureState();
  let migrated = false;

  if (!secureState) {
    const sessions = normalizeSessions(legacyData.deepseekSessions, legacyData.deepseekMessages);
    const currentSessionId = sessions.some((session) => session.id === legacyData.deepseekCurrentSessionId)
      ? legacyData.deepseekCurrentSessionId
      : sessions[0].id;
    const providerConfigs = normalizeProviderConfigs(
      legacyData.modelProviderConfigs,
      legacyData.deepseekApiKey || "",
      legacyData.deepseekModel || ""
    );
    await writeSecureState({
      config: {
        providerConfigs,
        systemPrompt: typeof legacyData.deepseekSystemPrompt === "string" ? legacyData.deepseekSystemPrompt : ""
      },
      sessions,
      currentSessionId
    });
    secureState = await readSecureState();
    const expectedImageCount = sessions.reduce((total, session) => (
      total + session.messages.reduce((messageTotal, message) => messageTotal + (message.images?.length || 0), 0)
    ), 0);
    const migratedImageCount = (secureState?.sessions || []).reduce((total, session) => (
      total + session.messages.reduce((messageTotal, message) => messageTotal + (message.images?.length || 0), 0)
    ), 0);
    if (
      !secureState
      || secureState.sessions.length !== sessions.length
      || migratedImageCount !== expectedImageCount
      || secureState.config.systemPrompt !== (legacyData.deepseekSystemPrompt || "")
      || secureState.config.providerConfigs.deepseek.apiKey !== providerConfigs.deepseek.apiKey
    ) {
      throw new Error("旧版数据迁移验证失败，明文数据仍已保留，请重新打开侧边栏后重试。");
    }
    migrated = true;
  }

  const providerConfigs = normalizeProviderConfigs(secureState.config.providerConfigs);
  const sessions = normalizeSessions(secureState.sessions);
  const availableProviderIds = new Set(getProviderProfiles(providerConfigs).map((provider) => provider.id));
  const requestedProvider = preferenceData[PREFERENCE_KEYS.activeProvider]
    || legacyData.activeModelProvider
    || DEFAULT_PROVIDER_ID;
  const activeProvider = availableProviderIds.has(requestedProvider) ? requestedProvider : DEFAULT_PROVIDER_ID;
  const preferredModel = preferenceData[PREFERENCE_KEYS.activeModel];
  if (
    typeof preferredModel === "string"
    && getProviderProfile(providerConfigs, activeProvider).models.some((model) => model.id === preferredModel)
  ) {
    providerConfigs[activeProvider].model = preferredModel;
  }
  const currentSessionId = sessions.some((session) => session.id === secureState.currentSessionId)
    ? secureState.currentSessionId
    : sessions[0].id;

  settings = {
    activeProvider,
    providerConfigs,
    mimoWebSearchMode: normalizeMimoWebSearchMode(
      preferenceData[PREFERENCE_KEYS.mimoWebSearchMode] ?? legacyData.mimoWebSearchMode
    ),
    theme: preferenceData[PREFERENCE_KEYS.theme] || legacyData.deepseekTheme || DEFAULT_THEME,
    systemPrompt: typeof secureState.config.systemPrompt === "string" ? secureState.config.systemPrompt : "",
    messages: [],
    sessions,
    currentSessionId
  };

  refreshProviderRegistry();
  syncCurrentSessionMessages();

  themeSelect.value = settings.theme;
  systemPromptInput.value = settings.systemPrompt;
  mimoWebSearchModeSelect.value = settings.mimoWebSearchMode;
  renderCustomProviderList();
  applyTheme(settings.theme);
  updateModelSwitchLabel();
  updateTokenUsageDisplay();
  await Promise.all([persistSecureState(), persistPreferences()]);
  await removeLegacyStorage();
  if (migrated) await garbageCollectSecureStore();
  renderMessages();
}

function buildProviderRequestBody(provider, config, options = {}) {
  return buildChatCompletionRequest({
    profile: provider,
    messages: options.messages || settings.messages,
    systemPrompt: options.includeSystemPrompt === false ? "" : settings.systemPrompt,
    stream: options.stream !== false,
    maxOutputTokens: options.maxTokens,
    includeWebSearch: options.includeWebSearch !== false,
    mimoWebSearchMode: settings.mimoWebSearchMode,
    overrides: options.overrides || {}
  });
}

async function rememberCustomCapability(providerId, key, value) {
  const config = settings.providerConfigs[providerId];
  if (config?.type !== "custom" || config.capabilityCache?.[key] === value) return;
  config.capabilityCache = { ...config.capabilityCache, [key]: value };
  refreshProviderRegistry();
  await persistSecureState();
}

async function fetchChatCompletion(provider, body) {
  return fetch(provider.endpoint, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(provider),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function callModelStream(onDelta) {
  let provider = getActiveProvider();
  let body = buildProviderRequestBody(provider, getActiveProviderConfig());
  let response = await fetchChatCompletion(provider, body);

  for (let attempt = 0; !response.ok && attempt < 2; attempt += 1) {
    const error = parseApiError(await response.text(), response.status);
    if (provider.type === "custom" && body.stream_options && isExplicitUnknownParameterError(error, "stream_options")) {
      await rememberCustomCapability(provider.id, "streamUsage", "implicit");
    } else if (provider.type === "custom" && body.thinking && isExplicitUnknownParameterError(error, "thinking")) {
      await rememberCustomCapability(provider.id, "thinking", "unsupported");
    } else {
      throw error;
    }
    provider = getActiveProvider();
    body = buildProviderRequestBody(provider, getActiveProviderConfig());
    response = await fetchChatCompletion(provider, body);
  }

  if (!response.ok) {
    throw parseApiError(await response.text(), response.status);
  }

  if (provider.type === "custom") {
    if (body.stream_options) await rememberCustomCapability(provider.id, "streamUsage", "include_usage");
    if (body.thinking) await rememberCustomCapability(provider.id, "thinking", "enabled");
  }

  if (!response.body) {
    throw new Error(provider.streamUnsupportedMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const accumulator = createStreamAccumulator({
    providerId: provider.id,
    model: provider.model,
    extractTaggedReasoning: provider.type === "custom"
  });

  function handleEventData(data) {
    const state = accumulator.push(data);
    if (state.changed) onDelta({ content: state.content, reasoningContent: state.reasoningContent });
    return state.done;
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

  const result = accumulator.result();
  if (!result.content) {
    throw new Error(provider.emptyResponseMessage);
  }

  return {
    content: result.content,
    reasoningContent: result.reasoningContent,
    usage: result.usage
  };
}

async function callModelOnce(messages, options = {}) {
  let provider = getActiveProvider();
  const config = getActiveProviderConfig();
  let maxOutputField = provider.capabilities.maxOutputField === "auto"
    ? "max_tokens"
    : provider.capabilities.maxOutputField;
  let body = buildProviderRequestBody(provider, config, {
    messages,
    stream: false,
    includeSystemPrompt: false,
    includeWebSearch: false,
    maxTokens: options.maxTokens,
    overrides: { maxOutputField }
  });
  let response = await fetchChatCompletion(provider, body);

  for (let attempt = 0; !response.ok && attempt < 2; attempt += 1) {
    const error = parseApiError(await response.text(), response.status);
    if (
      provider.type === "custom"
      && maxOutputField === "max_tokens"
      && isExplicitUnknownParameterError(error, "max_tokens")
    ) {
      maxOutputField = "max_completion_tokens";
    } else if (provider.type === "custom" && body.thinking && isExplicitUnknownParameterError(error, "thinking")) {
      await rememberCustomCapability(provider.id, "thinking", "unsupported");
    } else {
      throw error;
    }
    provider = getActiveProvider();
    body = buildProviderRequestBody(provider, config, {
      messages,
      stream: false,
      includeSystemPrompt: false,
      includeWebSearch: false,
      maxTokens: options.maxTokens,
      overrides: { maxOutputField }
    });
    response = await fetchChatCompletion(provider, body);
  }

  if (!response.ok) {
    throw parseApiError(await response.text(), response.status);
  }

  if (provider.type === "custom") {
    if (Number.isFinite(options.maxTokens)) {
      await rememberCustomCapability(provider.id, "maxOutputField", maxOutputField);
    }
    if (body.thinking) await rememberCustomCapability(provider.id, "thinking", "enabled");
    provider = getActiveProvider();
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
    usage: normalizeUsage(payload.usage, { providerId: provider.id, model: provider.model })
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
  if (!providerConfig.apiKey && provider.type === "builtin") {
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
    session.contextUsageState = "stale";
    session.updatedAt = Date.now();

    if (session.id === settings.currentSessionId) {
      settings.messages = session.messages;
    }

    await saveSessions();
    await garbageCollectSecureStore();

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
    const nextImages = await Promise.all(acceptedFiles.map(async (file) => ({
      id: `image-${crypto.randomUUID()}`,
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

  if (!providerConfig.apiKey && provider.type === "builtin") {
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
  settingsButton.disabled = true;
  historyButton.disabled = true;
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
    assistantMessage.updateReasoning(reply.reasoningContent);
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
    const session = getCurrentSession();
    session.contextUsage = reply.usage;
    session.contextUsageState = reply.usage?.promptTokens != null ? "measured" : "unavailable";
    await saveMessages();
    updateModelSwitchLabel();
    updateTokenUsageDisplay(reply.usage);
  } catch (error) {
    errorMessage = `请求失败：${error.message}`;
    getCurrentSession().contextUsageState = "stale";
    updateModelSwitchLabel("请求失败");
  } finally {
    isRequestInFlight = false;
    sendButton.disabled = false;
    settingsButton.disabled = false;
    historyButton.disabled = false;
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

tokenUsageButton.addEventListener("click", () => {
  if (!tokenUsageDetails.innerHTML) return;
  const open = tokenUsageDetails.hidden;
  tokenUsageDetails.hidden = !open;
  tokenUsageButton.setAttribute("aria-expanded", String(open));
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
  refreshProviderRegistry();
  markCurrentUsageStale();
  await Promise.all([persistSecureState(), persistPreferences()]);

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

document.addEventListener("click", (event) => {
  if (tokenUsageDetails.hidden || tokenUsageDetails.contains(event.target) || tokenUsageButton.contains(event.target)) return;
  tokenUsageDetails.hidden = true;
  tokenUsageButton.setAttribute("aria-expanded", "false");
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
  await garbageCollectSecureStore();
  renderMessages();
  updateTokenUsageDisplay();
  renderHistory();
});

saveSettingsButton.addEventListener("click", async () => {
  const previousSystemPrompt = settings.systemPrompt;
  settings.providerConfigs = normalizeProviderConfigs({
    ...settings.providerConfigs,
    deepseek: {
      apiKey: deepseekApiKeyInput.value.trim(),
      model: settings.providerConfigs.deepseek.model
    },
    mimo: {
      apiKey: mimoApiKeyInput.value.trim(),
      model: settings.providerConfigs.mimo.model
    }
  });
  settings.theme = themeSelect.value;
  settings.systemPrompt = systemPromptInput.value.trim();
  settings.mimoWebSearchMode = normalizeMimoWebSearchMode(mimoWebSearchModeSelect.value);
  refreshProviderRegistry();
  if (previousSystemPrompt !== settings.systemPrompt) markCurrentUsageStale();
  await Promise.all([persistSecureState(), persistPreferences()]);

  applyTheme(settings.theme);
  updateModelSwitchLabel();
  updateTokenUsageDisplay();
  closeSettings();
});

clearChatButton.addEventListener("click", async () => {
  const confirmed = window.confirm("确定要重置设置吗？API Key、自定义提供商、主题、系统提示词、联网搜索和模型选择会恢复默认，历史对话会保留。");
  if (!confirmed) return;

  const customOrigins = [...new Set(Object.values(settings.providerConfigs)
    .filter((config) => config.type === "custom")
    .map((config) => config.permissionOrigin))];
  settings.activeProvider = DEFAULT_PROVIDER_ID;
  settings.providerConfigs = createDefaultProviderConfigs();
  settings.theme = DEFAULT_THEME;
  settings.systemPrompt = "";
  settings.mimoWebSearchMode = DEFAULT_MIMO_WEB_SEARCH_MODE;

  deepseekApiKeyInput.value = settings.providerConfigs.deepseek.apiKey;
  mimoApiKeyInput.value = settings.providerConfigs.mimo.apiKey;
  themeSelect.value = settings.theme;
  systemPromptInput.value = settings.systemPrompt;
  mimoWebSearchModeSelect.value = settings.mimoWebSearchMode;
  clearCustomProviderForm();
  refreshProviderRegistry();
  markCurrentUsageStale();
  await Promise.all([persistSecureState(), persistPreferences()]);
  if (globalThis.chrome?.permissions && customOrigins.length > 0) {
    await chrome.permissions.remove({ origins: customOrigins });
  }

  applyTheme(settings.theme);
  updateModelSwitchLabel();
  updateTokenUsageDisplay();
  renderModelMenu();
  renderCustomProviderList();
});

saveCustomProviderButton.addEventListener("click", async () => {
  showSettingsNotice(customProviderNotice, "");
  const existingId = customProviderIdInput.value;
  const existing = settings.providerConfigs[existingId];
  let provider;
  try {
    provider = normalizeCustomProvider({
      ...existing,
      label: customProviderNameInput.value,
      endpoint: customProviderEndpointInput.value,
      apiKey: customProviderApiKeyInput.value,
      models: customProviderModelsInput.value,
      model: existing?.model,
      capabilityCache: existing?.endpoint === customProviderEndpointInput.value.trim()
        ? existing.capabilityCache
        : undefined
    }, existingId);
  } catch (error) {
    showSettingsNotice(customProviderNotice, error.message);
    return;
  }

  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [provider.permissionOrigin] });
  } catch (error) {
    showSettingsNotice(customProviderNotice, `无法申请 ${provider.origin} 的访问权限：${error.message}`);
    return;
  }
  if (!granted) {
    showSettingsNotice(customProviderNotice, `未授予 ${provider.origin} 的访问权限。配置未保存，完整对话上下文和 API Key 均不会发送。`);
    return;
  }

  const previousOrigin = existing?.permissionOrigin;
  settings.providerConfigs = normalizeProviderConfigs({
    ...settings.providerConfigs,
    [provider.id]: provider
  });
  refreshProviderRegistry();
  await Promise.all([persistSecureState(), persistPreferences()]);
  if (previousOrigin && previousOrigin !== provider.permissionOrigin) {
    await removeOriginPermissionIfUnused(previousOrigin);
  }
  clearCustomProviderForm();
  renderCustomProviderList();
  updateModelSwitchLabel();
});

cancelCustomProviderButton.addEventListener("click", clearCustomProviderForm);

customProviderList.addEventListener("click", async (event) => {
  const editButton = event.target.closest(".custom-provider-edit");
  const deleteButton = event.target.closest(".custom-provider-delete");
  const providerId = editButton?.dataset.providerId || deleteButton?.dataset.providerId;
  const provider = settings.providerConfigs[providerId];
  if (!provider || provider.type !== "custom") return;

  if (editButton) {
    customProviderIdInput.value = provider.id;
    customProviderNameInput.value = provider.label;
    customProviderEndpointInput.value = provider.endpoint;
    customProviderApiKeyInput.value = provider.apiKey;
    customProviderModelsInput.value = provider.models.map((model) => model.id).join("\n");
    saveCustomProviderButton.textContent = "保存提供商";
    cancelCustomProviderButton.hidden = false;
    showSettingsNotice(customProviderNotice, "");
    customProviderNameInput.focus();
    return;
  }

  if (!window.confirm(`确定删除自定义提供商“${provider.label}”吗？历史对话不会删除。`)) return;
  delete settings.providerConfigs[provider.id];
  if (settings.activeProvider === provider.id) settings.activeProvider = DEFAULT_PROVIDER_ID;
  refreshProviderRegistry();
  await Promise.all([persistSecureState(), persistPreferences()]);
  await removeOriginPermissionIfUnused(provider.permissionOrigin);
  if (customProviderIdInput.value === provider.id) clearCustomProviderForm();
  renderCustomProviderList();
  updateModelSwitchLabel();
});

cleanupCacheButton.addEventListener("click", async () => {
  cleanupCacheButton.disabled = true;
  showSettingsNotice(storageNotice, "正在检查孤儿缓存……");
  try {
    const result = await garbageCollectSecureStore();
    showSettingsNotice(
      storageNotice,
      `已删除 ${result.sessions} 个孤儿会话、${result.images} 张孤儿图片和 ${result.temporary} 条临时记录，释放约 ${formatReleasedBytes(result.releasedBytes)}。`
    );
  } catch (error) {
    showSettingsNotice(storageNotice, `清理失败：${error.message}`);
  } finally {
    cleanupCacheButton.disabled = false;
  }
});

clearAllDataButton.addEventListener("click", async () => {
  if (isRequestInFlight) {
    showSettingsNotice(storageNotice, "请等待当前请求完成后再清空全部本地数据。");
    return;
  }
  const confirmed = window.confirm("这会永久删除全部 API Key、自定义提供商、系统提示词、历史对话和图片。确定继续吗？");
  if (!confirmed) return;
  clearAllDataButton.disabled = true;
  try {
    await clearAllLocalData();
    location.reload();
  } catch (error) {
    showSettingsNotice(storageNotice, `清空失败：${error.message}`);
    clearAllDataButton.disabled = false;
  }
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
  markCurrentUsageStale();
  editingMessageIndex = -1;
  await saveMessages();
  await garbageCollectSecureStore();
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
  markCurrentUsageStale();
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
  showSettingsNotice(storageNotice, `${error.message} 如无法恢复，请使用“清空全部本地数据”重新初始化。`);
  settingsPanel.classList.add("open");
});
