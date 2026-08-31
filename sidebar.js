import {
  DEEPSEEK_ANTHROPIC_ENDPOINT,
  DEFAULT_PROVIDER_ID,
  buildAuthHeaders,
  buildChatCompletionRequest,
  buildDeepSeekAnthropicHeaders,
  buildDeepSeekWebSearchRequest,
  createAnthropicStreamAccumulator,
  createDefaultProviderConfigs,
  createStreamAccumulator,
  getProviderProfile,
  getProviderProfiles,
  isExplicitUnknownParameterError,
  normalizeProviderConfigs,
  normalizeUsage,
  parseApiError
} from "./providers.js";
import {
  PREFERENCE_KEYS,
  garbageCollectSecureStore,
  readLegacyStorage,
  readSecureBackgroundImage,
  readSecureConfig,
  readSecureState,
  removeLegacyStorage,
  writeSecureState
} from "./secure-storage.js";
import {
  DEFAULT_SHOW_TIMESTAMPS,
  DEFAULT_TIMESTAMP_FORMAT,
  formatMessageTimestamp,
  normalizeTimestampFormat
} from "./message-timestamps.js";
import {
  DEFAULT_FONT_SIZE,
  normalizeFontSize
} from "./font-size.js";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  getBackgroundImageTone,
  normalizeAppearanceSettings
} from "./appearance.js";

const DEFAULT_THEME = "system";
const DEFAULT_SHOW_TOKEN_USAGE = true;

const modelSwitchButton = document.getElementById("modelSwitchButton");
const modelMenu = document.getElementById("modelMenu");
const tokenUsageText = document.getElementById("tokenUsageText");
const settingsButton = document.getElementById("settingsButton");
const historyButton = document.getElementById("historyButton");
const historyPanel = document.getElementById("historyPanel");
const newChatButton = document.getElementById("newChatButton");
const historyList = document.getElementById("historyList");
const historyNotice = document.getElementById("historyNotice");
const historyNoticeText = document.getElementById("historyNoticeText");
const closeHistoryNoticeButton = document.getElementById("closeHistoryNoticeButton");
const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const pendingImagesEl = document.getElementById("pendingImages");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const tokenUsageButton = document.getElementById("tokenUsageButton");
const tokenUsageDetails = document.getElementById("tokenUsageDetails");
const appBackground = document.getElementById("appBackground");

const COMPOSER_MIN_HEIGHT = 64;
const COMPOSER_MAX_MARGIN = 120;
const DEFAULT_WEB_SEARCH_MODE = "off";
const WEB_SEARCH_MODES = ["off", "auto", "force"];
const DEFAULT_IMAGE_PROMPT = "请分析这张图片。";
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 4;

let settings = {
  activeProvider: DEFAULT_PROVIDER_ID,
  providerConfigs: createDefaultProviderConfigs(),
  webSearchMode: DEFAULT_WEB_SEARCH_MODE,
  theme: DEFAULT_THEME,
  ...DEFAULT_APPEARANCE_SETTINGS,
  fontSize: DEFAULT_FONT_SIZE,
  showTokenUsage: DEFAULT_SHOW_TOKEN_USAGE,
  showTimestamps: DEFAULT_SHOW_TIMESTAMPS,
  timestampFormat: DEFAULT_TIMESTAMP_FORMAT,
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
    [PREFERENCE_KEYS.fontSize]: settings.fontSize,
    [PREFERENCE_KEYS.activeProvider]: settings.activeProvider,
    [PREFERENCE_KEYS.activeModel]: activeConfig?.model || "",
    [PREFERENCE_KEYS.webSearchMode]: settings.webSearchMode,
    [PREFERENCE_KEYS.dockOpacity]: settings.dockOpacity,
    [PREFERENCE_KEYS.dockBlur]: settings.dockBlur,
    [PREFERENCE_KEYS.showTokenUsage]: settings.showTokenUsage,
    [PREFERENCE_KEYS.showTimestamps]: settings.showTimestamps,
    [PREFERENCE_KEYS.timestampFormat]: settings.timestampFormat,
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

function normalizeWebSearchMode(value) {
  return WEB_SEARCH_MODES.includes(value) ? value : DEFAULT_WEB_SEARCH_MODE;
}

function normalizeShowTimestamps(value) {
  return typeof value === "boolean" ? value : DEFAULT_SHOW_TIMESTAMPS;
}

function normalizeShowTokenUsage(value) {
  return typeof value === "boolean" ? value : DEFAULT_SHOW_TOKEN_USAGE;
}

function applyGlobalFontSize(value) {
  document.documentElement.style.setProperty("--global-font-size", `${normalizeFontSize(value)}px`);
}

function updateModelSwitchLabel(status = "") {
  const provider = getActiveProvider();
  const config = getActiveProviderConfig();
  const connected = Boolean(config.apiKey) || provider.type === "custom";
  const connectionLabel = connected ? "已连接" : "未连接";
  const statusLabel = status ? `${status}。` : "";
  modelSwitchButton.dataset.connected = String(connected);
  modelSwitchButton.title = `${statusLabel}${connectionLabel}：${provider.label} / ${config.model}。点击展开模型列表。`;
  modelSwitchButton.setAttribute("aria-label", `模型选择，${connectionLabel}，当前为 ${provider.label} ${config.model}${status ? `，${status}` : ""}`);
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

  modelMenu.appendChild(settingsButton);
}

function openModelMenu() {
  closeHistory(false);
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

  if (!settings.showTokenUsage) {
    tokenUsageButton.hidden = true;
    tokenUsageText.textContent = "";
    tokenUsageDetails.innerHTML = "";
    return;
  }

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

function applyAppearance(value) {
  const appearance = normalizeAppearanceSettings(value);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--bottom-dock-opacity", `${appearance.dockOpacity}%`);
  rootStyle.setProperty("--bottom-dock-blur", `${appearance.dockBlur}px`);

  appBackground.style.backgroundColor = appearance.backgroundMode === "solid"
    ? appearance.backgroundColor
    : "var(--bg)";
  const hasBackgroundImage = appearance.backgroundMode === "image" && Boolean(appearance.backgroundImage);
  appBackground.style.backgroundImage = hasBackgroundImage
    ? `url("${appearance.backgroundImage}")`
    : "none";
  const backgroundTone = getBackgroundImageTone(appearance.backgroundBrightness);
  appBackground.style.filter = hasBackgroundImage
    ? `brightness(${backgroundTone.imageBrightness}%)`
    : "none";
  rootStyle.setProperty(
    "--background-light-overlay-opacity",
    hasBackgroundImage ? String(backgroundTone.whiteOverlayOpacity) : "0"
  );
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
    images: normalizeImageAttachments(message.images),
    timestamp: Number.isFinite(message.timestamp) ? message.timestamp : null
  };
}

function supportsImageInput(provider) {
  return provider.capabilities.imageInput;
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

function openHistory() {
  closeModelMenu();
  closeHistoryNotice();
  renderHistory();
  historyPanel.classList.add("open");
  historyButton.setAttribute("aria-expanded", "true");
  newChatButton.focus();
}

function closeHistory(restoreFocus = true) {
  closeHistoryNotice();
  historyPanel.classList.remove("open");
  historyButton.setAttribute("aria-expanded", "false");
  if (restoreFocus) {
    historyButton.focus();
  }
}

async function openOptionsPage() {
  closeHistory(false);
  closeModelMenu();

  try {
    if (globalThis.chrome?.runtime?.openOptionsPage) {
      await chrome.runtime.openOptionsPage();
      return;
    }
    window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener");
  } catch (error) {
    appendMessage("system", `无法打开拓展选项：${error.message}`);
  }
}

function renderMessages(options = {}) {
  const previousScrollTop = messagesEl.scrollTop;
  messagesEl.innerHTML = "";

  if (settings.messages.length === 0) {
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
      reasoningContent: message.reasoningContent || "",
      timestamp: message.timestamp
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

function createMessageTimestamp(timestamp) {
  if (!settings.showTimestamps) {
    return null;
  }

  const text = formatMessageTimestamp(timestamp, settings.timestampFormat);
  if (!text) {
    return null;
  }

  const element = document.createElement("time");
  element.className = "message-timestamp";
  element.dateTime = new Date(timestamp).toISOString();
  element.textContent = text;
  element.title = formatMessageTimestamp(timestamp, "full");
  return element;
}

function createMessageFooter(options = {}) {
  const timestamp = createMessageTimestamp(options.timestamp);
  if (!timestamp && !options.editable) {
    return null;
  }

  const footer = document.createElement("div");
  footer.className = "message-footer";
  if (timestamp) {
    footer.appendChild(timestamp);
  }

  if (options.editable) {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "message-edit";
    editButton.dataset.messageIndex = String(options.messageIndex);
    editButton.setAttribute("aria-label", "编辑并重新发送这条消息");
    editButton.setAttribute("title", "编辑并重新发送");
    editButton.textContent = "编辑";
    footer.appendChild(editButton);
  }

  return footer;
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
    const footer = createMessageFooter(options);
    if (footer) {
      wrapper.appendChild(footer);
    }
    messagesEl.appendChild(wrapper);
    scrollMessagesToBottom();
    return controls;
  }

  const body = document.createElement("div");
  body.className = "message-content";
  setMessageContent(body, role, content, options);
  wrapper.appendChild(body);

  const footer = createMessageFooter({
    ...options,
    editable: role === "user" && options.editable
  });
  if (footer) {
    wrapper.appendChild(footer);
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
    webSearchMode: normalizeWebSearchMode(
      preferenceData[PREFERENCE_KEYS.webSearchMode]
        ?? legacyData["edgeChat.mimoWebSearchMode"]
        ?? legacyData.mimoWebSearchMode
    ),
    theme: preferenceData[PREFERENCE_KEYS.theme] || legacyData.deepseekTheme || DEFAULT_THEME,
    ...normalizeAppearanceSettings({
      backgroundMode: preferenceData[PREFERENCE_KEYS.backgroundMode],
      backgroundColor: preferenceData[PREFERENCE_KEYS.backgroundColor],
      backgroundImage: await readSecureBackgroundImage(),
      backgroundBrightness: preferenceData[PREFERENCE_KEYS.backgroundBrightness],
      dockOpacity: preferenceData[PREFERENCE_KEYS.dockOpacity],
      dockBlur: preferenceData[PREFERENCE_KEYS.dockBlur],
      composerOpacity: preferenceData[PREFERENCE_KEYS.composerOpacity],
      composerBlur: preferenceData[PREFERENCE_KEYS.composerBlur],
      statusbarOpacity: preferenceData[PREFERENCE_KEYS.statusbarOpacity],
      statusbarBlur: preferenceData[PREFERENCE_KEYS.statusbarBlur]
    }),
    fontSize: normalizeFontSize(
      preferenceData[PREFERENCE_KEYS.fontSize] ?? legacyData["edgeChat.messageFontSize"]
    ),
    showTokenUsage: normalizeShowTokenUsage(preferenceData[PREFERENCE_KEYS.showTokenUsage]),
    showTimestamps: normalizeShowTimestamps(preferenceData[PREFERENCE_KEYS.showTimestamps]),
    timestampFormat: normalizeTimestampFormat(preferenceData[PREFERENCE_KEYS.timestampFormat]),
    systemPrompt: typeof secureState.config.systemPrompt === "string" ? secureState.config.systemPrompt : "",
    messages: [],
    sessions,
    currentSessionId
  };

  refreshProviderRegistry();
  syncCurrentSessionMessages();

  applyTheme(settings.theme);
  applyAppearance(settings);
  applyGlobalFontSize(settings.fontSize);
  syncComposerHeight();
  updateModelSwitchLabel();
  updateTokenUsageDisplay();
  await Promise.all([persistSecureState(), persistPreferences()]);
  await removeLegacyStorage();
  if (migrated) await garbageCollectSecureStore();
  renderMessages();
}

async function reloadOptionsConfiguration() {
  const [preferenceData, secureConfig, backgroundImage] = await Promise.all([
    storageGet(Object.values(PREFERENCE_KEYS)),
    readSecureConfig(),
    readSecureBackgroundImage()
  ]);

  if (!secureConfig) {
    location.reload();
    return;
  }

  const previousSystemPrompt = settings.systemPrompt;
  const providerConfigs = normalizeProviderConfigs(secureConfig.providerConfigs);
  const availableProviderIds = new Set(getProviderProfiles(providerConfigs).map((provider) => provider.id));
  const requestedProvider = preferenceData[PREFERENCE_KEYS.activeProvider] || DEFAULT_PROVIDER_ID;
  const activeProvider = availableProviderIds.has(requestedProvider) ? requestedProvider : DEFAULT_PROVIDER_ID;
  const preferredModel = preferenceData[PREFERENCE_KEYS.activeModel];
  if (
    typeof preferredModel === "string"
    && getProviderProfile(providerConfigs, activeProvider).models.some((model) => model.id === preferredModel)
  ) {
    providerConfigs[activeProvider].model = preferredModel;
  }

  settings.activeProvider = activeProvider;
  settings.providerConfigs = providerConfigs;
  settings.webSearchMode = normalizeWebSearchMode(preferenceData[PREFERENCE_KEYS.webSearchMode]);
  settings.theme = preferenceData[PREFERENCE_KEYS.theme] || DEFAULT_THEME;
  Object.assign(settings, normalizeAppearanceSettings({
    backgroundMode: preferenceData[PREFERENCE_KEYS.backgroundMode],
    backgroundColor: preferenceData[PREFERENCE_KEYS.backgroundColor],
    backgroundImage,
    backgroundBrightness: preferenceData[PREFERENCE_KEYS.backgroundBrightness],
    dockOpacity: preferenceData[PREFERENCE_KEYS.dockOpacity],
    dockBlur: preferenceData[PREFERENCE_KEYS.dockBlur],
    composerOpacity: preferenceData[PREFERENCE_KEYS.composerOpacity],
    composerBlur: preferenceData[PREFERENCE_KEYS.composerBlur],
    statusbarOpacity: preferenceData[PREFERENCE_KEYS.statusbarOpacity],
    statusbarBlur: preferenceData[PREFERENCE_KEYS.statusbarBlur]
  }));
  settings.fontSize = normalizeFontSize(preferenceData[PREFERENCE_KEYS.fontSize]);
  settings.showTokenUsage = normalizeShowTokenUsage(preferenceData[PREFERENCE_KEYS.showTokenUsage]);
  settings.showTimestamps = normalizeShowTimestamps(preferenceData[PREFERENCE_KEYS.showTimestamps]);
  settings.timestampFormat = normalizeTimestampFormat(preferenceData[PREFERENCE_KEYS.timestampFormat]);
  settings.systemPrompt = typeof secureConfig.systemPrompt === "string" ? secureConfig.systemPrompt : "";

  refreshProviderRegistry();
  if (previousSystemPrompt !== settings.systemPrompt) markCurrentUsageStale();
  applyTheme(settings.theme);
  applyAppearance(settings);
  applyGlobalFontSize(settings.fontSize);
  syncComposerHeight();
  renderMessages({ preserveScroll: true });
  updateModelSwitchLabel();
  updateTokenUsageDisplay();
}

function buildProviderRequestBody(provider, config, options = {}) {
  return buildChatCompletionRequest({
    profile: provider,
    messages: options.messages || settings.messages,
    systemPrompt: options.includeSystemPrompt === false ? "" : settings.systemPrompt,
    stream: options.stream !== false,
    maxOutputTokens: options.maxTokens,
    includeWebSearch: options.includeWebSearch !== false,
    webSearchMode: settings.webSearchMode,
    overrides: options.overrides || {}
  });
}

function shouldUseDeepSeekWebSearch(provider, options = {}) {
  return provider.id === "deepseek"
    && provider.capabilities.webSearch
    && options.includeWebSearch !== false
    && settings.webSearchMode !== "off";
}

function buildStreamingRequest(provider) {
  if (shouldUseDeepSeekWebSearch(provider)) {
    return {
      protocol: "anthropic",
      endpoint: DEEPSEEK_ANTHROPIC_ENDPOINT,
      headers: buildDeepSeekAnthropicHeaders(provider),
      body: buildDeepSeekWebSearchRequest({
        profile: provider,
        messages: settings.messages,
        systemPrompt: settings.systemPrompt,
        stream: true,
        webSearchMode: settings.webSearchMode
      })
    };
  }

  return {
    protocol: "chat-completions",
    endpoint: provider.endpoint,
    headers: buildAuthHeaders(provider),
    body: buildProviderRequestBody(provider, getActiveProviderConfig())
  };
}

async function rememberCustomCapability(providerId, key, value) {
  const config = settings.providerConfigs[providerId];
  if (config?.type !== "custom" || config.capabilityCache?.[key] === value) return;
  config.capabilityCache = { ...config.capabilityCache, [key]: value };
  refreshProviderRegistry();
  await persistSecureState();
}

async function fetchModelRequest({ endpoint, headers, body }) {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function callModelStream(onDelta) {
  let provider = getActiveProvider();
  let request = buildStreamingRequest(provider);
  let response = await fetchModelRequest(request);

  for (let attempt = 0; !response.ok && attempt < 2; attempt += 1) {
    const error = parseApiError(await response.text(), response.status);
    if (provider.type === "custom" && request.body.stream_options && isExplicitUnknownParameterError(error, "stream_options")) {
      await rememberCustomCapability(provider.id, "streamUsage", "implicit");
    } else if (provider.type === "custom" && request.body.thinking && isExplicitUnknownParameterError(error, "thinking")) {
      await rememberCustomCapability(provider.id, "thinking", "unsupported");
    } else {
      throw error;
    }
    provider = getActiveProvider();
    request = buildStreamingRequest(provider);
    response = await fetchModelRequest(request);
  }

  if (!response.ok) {
    throw parseApiError(await response.text(), response.status);
  }

  if (provider.type === "custom") {
    if (request.body.stream_options) await rememberCustomCapability(provider.id, "streamUsage", "include_usage");
    if (request.body.thinking) await rememberCustomCapability(provider.id, "thinking", "enabled");
  }

  if (!response.body) {
    throw new Error(provider.streamUnsupportedMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const accumulatorMetadata = {
    providerId: provider.id,
    model: provider.model,
    extractTaggedReasoning: provider.type === "custom"
  };
  const accumulator = request.protocol === "anthropic"
    ? createAnthropicStreamAccumulator(accumulatorMetadata)
    : createStreamAccumulator(accumulatorMetadata);

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
  let response = await fetchModelRequest({
    endpoint: provider.endpoint,
    headers: buildAuthHeaders(provider),
    body
  });

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
    response = await fetchModelRequest({
      endpoint: provider.endpoint,
      headers: buildAuthHeaders(provider),
      body
    });
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
    openOptionsPage();
    appendMessage("system", `请先在拓展选项的模型 API 页面保存 ${provider.label} API Key。`);
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
        content: `以下为已压缩的历史上下文摘要：\n${summary.trim()}`,
        timestamp: Date.now()
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

  syncComposerHeight();
}

function syncComposerHeight() {
  messageInput.style.height = "0px";
  const textHeight = messageInput.scrollHeight;
  messageInput.style.removeProperty("height");

  const imageHeight = pendingImages.length > 0
    ? pendingImagesEl.getBoundingClientRect().height + 8
    : 0;
  const naturalHeight = textHeight + imageHeight + 20;
  const maxHeight = Math.max(COMPOSER_MIN_HEIGHT, window.innerHeight - COMPOSER_MAX_MARGIN);
  const nextHeight = Math.min(maxHeight, Math.max(COMPOSER_MIN_HEIGHT, naturalHeight));

  document.documentElement.style.setProperty("--composer-height", `${Math.ceil(nextHeight)}px`);
  messageInput.style.overflowY = naturalHeight > maxHeight ? "auto" : "hidden";
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

  if (images.length > 0 && !supportsImageInput(provider)) {
    appendMessage("system", `当前模型 ${provider.model} 不支持图片输入，请切换到视觉模型后再发送。`);
    return false;
  }

  if (!providerConfig.apiKey && provider.type === "builtin") {
    openOptionsPage();
    appendMessage("system", `请先在拓展选项的模型 API 页面保存 ${provider.label} API Key。`);
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
      usage: reply.usage,
      timestamp: Date.now()
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
  closeModelMenu();
  openOptionsPage();
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

closeHistoryNoticeButton.addEventListener("click", () => {
  closeHistoryNotice();
});

historyNotice.addEventListener("click", (event) => {
  if (event.target === historyNotice) {
    closeHistoryNotice();
  }
});

document.addEventListener("click", (event) => {
  if (
    !historyPanel.classList.contains("open")
    || historyPanel.contains(event.target)
    || historyButton.contains(event.target)
  ) {
    return;
  }

  closeHistory(false);
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
    { role: "user", content, images, timestamp: Date.now() }
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

messageInput.addEventListener("input", syncComposerHeight);
window.addEventListener("resize", syncComposerHeight);

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

  const userMessage = { role: "user", content, images, timestamp: Date.now() };
  settings.messages.push(userMessage);
  markCurrentUsageStale();
  appendMessage("user", content, { images, timestamp: userMessage.timestamp });
  messageInput.value = "";
  syncComposerHeight();
  pendingImages = [];
  renderPendingImages();
  await saveMessages();
  await requestReplyForCurrentMessages();
});

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "edgeChat.optionsChanged") return;
    if (message.resetData) {
      location.reload();
      return;
    }
    reloadOptionsConfiguration().catch((error) => {
      appendMessage("system", `无法刷新拓展选项：${error.message}`);
    });
  });
}

syncComposerHeight();

loadSettings().catch((error) => {
  updateModelSwitchLabel("初始化失败");
  appendMessage("system", `${error.message} 如无法恢复，请在拓展选项中清空全部本地数据后重新初始化。`);
});
