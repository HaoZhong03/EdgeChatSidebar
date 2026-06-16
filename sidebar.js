const STORAGE_KEYS = {
  apiKey: "deepseekApiKey",
  model: "deepseekModel",
  theme: "deepseekTheme",
  systemPrompt: "deepseekSystemPrompt",
  messages: "deepseekMessages",
  sessions: "deepseekSessions",
  currentSessionId: "deepseekCurrentSessionId"
};

const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_THEME = "system";
const API_URL = "https://api.deepseek.com/chat/completions";

const statusText = document.getElementById("statusText");
const tokenUsageText = document.getElementById("tokenUsageText");
const settingsButton = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsPanel");
const closeSettingsButton = document.getElementById("closeSettingsButton");
const historyButton = document.getElementById("historyButton");
const historyPanel = document.getElementById("historyPanel");
const closeHistoryButton = document.getElementById("closeHistoryButton");
const newChatButton = document.getElementById("newChatButton");
const historyList = document.getElementById("historyList");
const apiKeyInput = document.getElementById("apiKeyInput");
const modelSelect = document.getElementById("modelSelect");
const themeSelect = document.getElementById("themeSelect");
const systemPromptInput = document.getElementById("systemPromptInput");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const clearChatButton = document.getElementById("clearChatButton");
const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const composerResizeHandle = document.getElementById("composerResizeHandle");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

const COMPOSER_MIN_HEIGHT = 64;
const COMPOSER_MAX_MARGIN = 120;

let settings = {
  apiKey: "",
  model: DEFAULT_MODEL,
  theme: DEFAULT_THEME,
  systemPrompt: "",
  messages: [],
  sessions: [],
  currentSessionId: ""
};

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(value) {
  return chrome.storage.local.set(value);
}

function updateStatus(text) {
  statusText.textContent = text;
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

function applyTheme(theme) {
  const nextTheme = ["light", "dark", "system"].includes(theme) ? theme : DEFAULT_THEME;
  document.documentElement.dataset.theme = nextTheme;
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
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  const title = firstUserMessage?.content.trim() || "新对话";

  return title.length > 24 ? `${title.slice(0, 24)}...` : title;
}

function normalizeSessions(value, legacyMessages) {
  const sessions = Array.isArray(value)
    ? value
        .filter((session) => session && typeof session.id === "string")
        .map((session) => ({
          id: session.id,
          title: session.title || buildSessionTitle(Array.isArray(session.messages) ? session.messages : []),
          messages: Array.isArray(session.messages) ? session.messages : [],
          createdAt: Number.isFinite(session.createdAt) ? session.createdAt : Date.now(),
          updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : Date.now()
        }))
    : [];

  if (sessions.length > 0) {
    return sessions;
  }

  if (Array.isArray(legacyMessages) && legacyMessages.length > 0) {
    return [createSession(legacyMessages)];
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
    deleteButton.textContent = "×";

    item.append(selectButton, deleteButton);
    historyList.appendChild(item);
  }
}

function openSettings() {
  closeHistory(false);
  settingsPanel.classList.add("open");
  apiKeyInput.focus();
}

function closeSettings(restoreFocus = true) {
  settingsPanel.classList.remove("open");
  if (restoreFocus) {
    settingsButton.focus();
  }
}

function openHistory() {
  closeSettings(false);
  renderHistory();
  historyPanel.classList.add("open");
  newChatButton.focus();
}

function closeHistory(restoreFocus = true) {
  historyPanel.classList.remove("open");
  if (restoreFocus) {
    historyButton.focus();
  }
}

function renderMessages() {
  messagesEl.innerHTML = "";

  if (settings.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "先在设置里保存 DeepSeek API Key，然后开始对话。";
    messagesEl.appendChild(empty);
    return;
  }

  for (const message of settings.messages) {
    appendMessage(message.role, message.content, {
      reasoningContent: message.reasoningContent || ""
    });
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

function renderInlineMarkdown(value) {
  const tokens = [];

  function addToken(html) {
    const token = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return token;
  }

  const tokenized = value
    .replace(/`([^`]+)`/g, (_, code) => addToken(`<code>${escapeHtml(code)}</code>`))
    .replace(/\\\((.+?)\\\)/g, (_, latex) => addToken(renderLatex(latex)))
    .replace(/(^|[^\w\\])\$([^\s$](?:.*?[^\s$])?)\$(?!\d)/g, (_, prefix, latex) => `${prefix}${addToken(renderLatex(latex))}`);

  return escapeHtml(tokenized)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\u0000(\d+)\u0000/g, (_, tokenIndex) => tokens[Number(tokenIndex)]);
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listType = null;
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines = [];
  let quoteLines = [];

  function closeParagraph() {
    if (paragraph.length === 0) return;
    html.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  }

  function closeQuote() {
    if (quoteLines.length === 0) return;
    html.push(`<blockquote>${quoteLines.map(renderInlineMarkdown).join("<br>")}</blockquote>`);
    quoteLines = [];
  }

  function splitTableRow(line) {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  function isTableSeparator(line) {
    return splitTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const codeFence = line.match(/^```(\S*)\s*$/);

    if (codeFence) {
      if (inCodeBlock) {
        html.push(`<pre><code class="${codeLanguage ? `language-${escapeHtml(codeLanguage)}` : ""}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCodeBlock = false;
        codeLanguage = "";
        codeLines = [];
      } else {
        closeParagraph();
        closeList();
        closeQuote();
        inCodeBlock = true;
        codeLanguage = codeFence[1] || "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeParagraph();
      closeList();
      closeQuote();
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeParagraph();
      closeList();
      closeQuote();
      html.push("<hr>");
      continue;
    }

    const displayMathStart = line.match(/^\s*(\$\$|\\\[)(.*)$/);
    if (displayMathStart) {
      closeParagraph();
      closeList();
      closeQuote();

      const closingToken = displayMathStart[1] === "$$" ? "$$" : "\\]";
      const mathLines = [];
      let firstLine = displayMathStart[2];
      let closingIndex = firstLine.indexOf(closingToken);

      if (closingIndex !== -1) {
        html.push(renderLatex(firstLine.slice(0, closingIndex), true));
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

      html.push(renderLatex(mathLines.join("\n"), true));
      continue;
    }

    if (line.includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      closeParagraph();
      closeList();
      closeQuote();

      const headers = splitTableRow(line);
      const rows = [];
      index += 2;

      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;

      html.push("<table>");
      html.push(`<thead><tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead>`);
      html.push(`<tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInlineMarkdown(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}</tbody>`);
      html.push("</table>");
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      closeParagraph();
      closeList();
      closeQuote();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeParagraph();
      closeList();
      quoteLines.push(quote[1]);
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);

    if (unordered || ordered) {
      closeParagraph();
      closeQuote();
      const nextType = unordered ? "ul" : "ol";
      if (listType !== nextType) {
        closeList();
        html.push(`<${nextType}>`);
        listType = nextType;
      }
      html.push(`<li>${renderInlineMarkdown((unordered || ordered)[1])}</li>`);
      continue;
    }

    closeList();
    closeQuote();
    paragraph.push(line);
  }

  if (inCodeBlock) {
    html.push(`<pre><code class="${codeLanguage ? `language-${escapeHtml(codeLanguage)}` : ""}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  closeParagraph();
  closeList();
  closeQuote();

  return html.join("");
}

function setMessageContent(element, role, content) {
  if (role === "assistant") {
    element.innerHTML = renderMarkdown(content);
    return;
  }

  element.textContent = content;
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
  setMessageContent(body, role, content);
  wrapper.appendChild(body);
  messagesEl.appendChild(wrapper);
  scrollMessagesToBottom();
  return body;
}

function buildApiMessages() {
  const messages = settings.messages.map(({ role, content }) => ({ role, content }));

  if (settings.systemPrompt.trim()) {
    return [
      { role: "system", content: settings.systemPrompt.trim() },
      ...messages
    ];
  }

  return messages;
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

  settings = {
    apiKey: data[STORAGE_KEYS.apiKey] || "",
    model: data[STORAGE_KEYS.model] || DEFAULT_MODEL,
    theme: data[STORAGE_KEYS.theme] || DEFAULT_THEME,
    systemPrompt: data[STORAGE_KEYS.systemPrompt] || "",
    messages: [],
    sessions,
    currentSessionId
  };

  syncCurrentSessionMessages();

  apiKeyInput.value = settings.apiKey;
  modelSelect.value = settings.model;
  themeSelect.value = settings.theme;
  systemPromptInput.value = settings.systemPrompt;
  applyTheme(settings.theme);
  updateStatus(settings.apiKey ? `已连接 · ${settings.model}` : "未连接");
  updateTokenUsageDisplay();
  await saveSessions();
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

async function callDeepSeekStream(onDelta) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.model,
      messages: buildApiMessages(),
      stream: true,
      stream_options: {
        include_usage: true
      },
      thinking: {
        type: "enabled"
      }
    })
  });

  if (!response.ok) {
    throw new Error(parseStreamErrorText(await response.text(), response.status));
  }

  if (!response.body) {
    throw new Error("当前浏览器不支持读取 DeepSeek 流式响应。");
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
      throw new Error("DeepSeek 返回了无法解析的流式响应。");
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
    throw new Error("DeepSeek 没有返回可显示的内容。");
  }

  return {
    content,
    reasoningContent,
    usage
  };
}

settingsButton.addEventListener("click", () => {
  if (settingsPanel.classList.contains("open")) {
    closeSettings();
    return;
  }

  openSettings();
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
  settings.apiKey = apiKeyInput.value.trim();
  settings.model = modelSelect.value;
  settings.theme = themeSelect.value;
  settings.systemPrompt = systemPromptInput.value.trim();

  await storageSet({
    [STORAGE_KEYS.apiKey]: settings.apiKey,
    [STORAGE_KEYS.model]: settings.model,
    [STORAGE_KEYS.theme]: settings.theme,
    [STORAGE_KEYS.systemPrompt]: settings.systemPrompt
  });

  applyTheme(settings.theme);
  updateStatus(settings.apiKey ? `已连接 · ${settings.model}` : "未连接");
  updateTokenUsageDisplay();
  closeSettings();
});

clearChatButton.addEventListener("click", async () => {
  settings.messages = [];
  await saveMessages();
  renderMessages();
  updateTokenUsageDisplay();
});

composerResizeHandle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;

  const startY = event.clientY;
  const startHeight = chatForm.getBoundingClientRect().height;

  composerResizeHandle.setPointerCapture(event.pointerId);
  document.body.classList.add("composer-resizing");
  event.preventDefault();

  const resizeComposer = (pointerEvent) => {
    const maxHeight = Math.max(
      COMPOSER_MIN_HEIGHT,
      window.innerHeight - COMPOSER_MAX_MARGIN
    );
    const nextHeight = Math.min(
      maxHeight,
      Math.max(COMPOSER_MIN_HEIGHT, startHeight + startY - pointerEvent.clientY)
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

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const content = messageInput.value.trim();
  if (!content) return;

  if (!settings.apiKey) {
    openSettings();
    appendMessage("system", "请先保存 DeepSeek API Key。");
    return;
  }

  settings.messages.push({ role: "user", content });
  appendMessage("user", content);
  messageInput.value = "";
  await saveMessages();

  const assistantMessage = appendMessage("assistant", "", { streaming: true });
  sendButton.disabled = true;
  updateStatus("请求中...");

  try {
    const reply = await callDeepSeekStream(({ content: replyContent, reasoningContent }) => {
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
    updateStatus(`已连接 · ${settings.model}`);
    updateTokenUsageDisplay(reply.usage);
  } catch (error) {
    setMessageContent(assistantMessage.body, "system", `请求失败：${error.message}`);
    updateStatus("请求失败");
  } finally {
    sendButton.disabled = false;
    messageInput.focus();
  }
});

loadSettings().catch((error) => {
  updateStatus("初始化失败");
  appendMessage("system", error.message);
});
