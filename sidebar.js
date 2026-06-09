const STORAGE_KEYS = {
  apiKey: "deepseekApiKey",
  model: "deepseekModel",
  theme: "deepseekTheme",
  systemPrompt: "deepseekSystemPrompt",
  messages: "deepseekMessages"
};

const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_THEME = "system";
const API_URL = "https://api.deepseek.com/chat/completions";

const statusText = document.getElementById("statusText");
const settingsButton = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsPanel");
const closeSettingsButton = document.getElementById("closeSettingsButton");
const apiKeyInput = document.getElementById("apiKeyInput");
const modelSelect = document.getElementById("modelSelect");
const themeSelect = document.getElementById("themeSelect");
const systemPromptInput = document.getElementById("systemPromptInput");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const clearChatButton = document.getElementById("clearChatButton");
const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const expandComposerButton = document.getElementById("expandComposerButton");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

let settings = {
  apiKey: "",
  model: DEFAULT_MODEL,
  theme: DEFAULT_THEME,
  systemPrompt: "",
  messages: []
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

function applyTheme(theme) {
  const nextTheme = ["light", "dark", "system"].includes(theme) ? theme : DEFAULT_THEME;
  document.documentElement.dataset.theme = nextTheme;
}

function openSettings() {
  settingsPanel.classList.add("open");
  apiKeyInput.focus();
}

function closeSettings() {
  settingsPanel.classList.remove("open");
  settingsButton.focus();
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
    appendMessage(message.role, message.content);
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

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
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

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeParagraph();
      closeList();
      closeQuote();
      const level = heading[1].length + 2;
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

function appendMessage(role, content) {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${role}`;

  const body = document.createElement("div");
  body.className = "message-content";
  setMessageContent(body, role, content);

  wrapper.appendChild(body);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
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
  await storageSet({ [STORAGE_KEYS.messages]: settings.messages });
}

async function loadSettings() {
  const data = await storageGet(Object.values(STORAGE_KEYS));

  settings = {
    apiKey: data[STORAGE_KEYS.apiKey] || "",
    model: data[STORAGE_KEYS.model] || DEFAULT_MODEL,
    theme: data[STORAGE_KEYS.theme] || DEFAULT_THEME,
    systemPrompt: data[STORAGE_KEYS.systemPrompt] || "",
    messages: Array.isArray(data[STORAGE_KEYS.messages]) ? data[STORAGE_KEYS.messages] : []
  };

  apiKeyInput.value = settings.apiKey;
  modelSelect.value = settings.model;
  themeSelect.value = settings.theme;
  systemPromptInput.value = settings.systemPrompt;
  applyTheme(settings.theme);
  updateStatus(settings.apiKey ? `已连接 · ${settings.model}` : "未连接");
  renderMessages();
}

async function callDeepSeek() {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.model,
      messages: buildApiMessages(),
      stream: false
    })
  });

  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(text || "DeepSeek 返回了无法解析的响应。");
  }

  if (!response.ok) {
    const message = payload.error?.message || payload.message || `请求失败，状态码 ${response.status}`;
    throw new Error(message);
  }

  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("DeepSeek 没有返回可显示的内容。");
  }

  return content;
}

settingsButton.addEventListener("click", () => {
  if (settingsPanel.classList.contains("open")) {
    closeSettings();
    return;
  }

  openSettings();
});

closeSettingsButton.addEventListener("click", () => {
  closeSettings();
});

settingsPanel.addEventListener("click", (event) => {
  if (event.target === settingsPanel) {
    closeSettings();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && settingsPanel.classList.contains("open")) {
    closeSettings();
  }
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
  closeSettings();
});

clearChatButton.addEventListener("click", async () => {
  settings.messages = [];
  await saveMessages();
  renderMessages();
});

expandComposerButton.addEventListener("click", () => {
  const expanded = chatForm.classList.toggle("expanded");
  const label = expanded ? "收起输入框" : "展开输入框";

  expandComposerButton.setAttribute("aria-label", label);
  expandComposerButton.setAttribute("title", label);
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

  const assistantBody = appendMessage("assistant", "正在思考...");
  sendButton.disabled = true;
  updateStatus("请求中...");

  try {
    const reply = await callDeepSeek();
    setMessageContent(assistantBody, "assistant", reply);
    settings.messages.push({ role: "assistant", content: reply });
    await saveMessages();
    updateStatus(`已连接 · ${settings.model}`);
  } catch (error) {
    setMessageContent(assistantBody, "system", `请求失败：${error.message}`);
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
