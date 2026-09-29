import {
  DEFAULT_PROVIDER_ID,
  createDefaultProviderConfigs,
  getProviderProfile,
  getProviderProfiles,
  normalizeCustomProvider,
  normalizeProviderConfigs
} from "./providers.js";
import {
  PREFERENCE_KEYS,
  clearAllLocalData,
  formatReleasedBytes,
  garbageCollectSecureStore,
  markSecureCurrentSessionUsageStale,
  readLegacyStorage,
  readSecureBackgroundImage,
  readSecureConfig,
  readSecureState,
  removeLegacyStorage,
  writeSecureConfig,
  writeSecureBackgroundImage,
  writeSecureState
} from "./secure-storage.js";
import {
  DEFAULT_SHOW_TIMESTAMPS,
  DEFAULT_TIMESTAMP_FORMAT,
  normalizeTimestampFormat
} from "./message-timestamps.js";
import {
  DEFAULT_FONT_SIZE,
  normalizeFontSize
} from "./font-size.js";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  MAX_BACKGROUND_IMAGE_BYTES,
  PRESET_BACKGROUND_COLORS,
  SUPPORTED_BACKGROUND_IMAGE_TYPES,
  isValidHexColor,
  normalizeAppearanceSettings,
  normalizeBackgroundImage,
  normalizeHexColor
} from "./appearance.js";
import {
  UPDATE_PERMISSION_ORIGINS,
  compareVersions,
  fetchLatestVersion,
  installLocalUpdate
} from "./updater.js";
import { createConfigArchive, parseConfigArchive } from "./config-transfer.js";

const DEFAULT_THEME = "system";
const DEFAULT_SHOW_TOKEN_USAGE = true;
const THEMES = ["system", "light", "dark"];

const themeSelect = document.getElementById("themeSelect");
const backgroundModeSelect = document.getElementById("backgroundModeSelect");
const solidBackgroundSettings = document.getElementById("solidBackgroundSettings");
const imageBackgroundSettings = document.getElementById("imageBackgroundSettings");
const backgroundBrightnessSettings = document.getElementById("backgroundBrightnessSettings");
const presetColorList = document.getElementById("presetColorList");
const backgroundColorPicker = document.getElementById("backgroundColorPicker");
const backgroundColorInput = document.getElementById("backgroundColorInput");
const backgroundImageInput = document.getElementById("backgroundImageInput");
const backgroundImagePreview = document.getElementById("backgroundImagePreview");
const backgroundImagePreviewImage = document.getElementById("backgroundImagePreviewImage");
const removeBackgroundImageButton = document.getElementById("removeBackgroundImageButton");
const backgroundBrightnessInput = document.getElementById("backgroundBrightnessInput");
const backgroundBrightnessValue = document.getElementById("backgroundBrightnessValue");
const dockOpacityInput = document.getElementById("dockOpacityInput");
const dockOpacityValue = document.getElementById("dockOpacityValue");
const dockBlurInput = document.getElementById("dockBlurInput");
const dockBlurValue = document.getElementById("dockBlurValue");
const componentOpacityInput = document.getElementById("componentOpacityInput");
const componentOpacityValue = document.getElementById("componentOpacityValue");
const componentBlurInput = document.getElementById("componentBlurInput");
const componentBlurValue = document.getElementById("componentBlurValue");
const fontSizeInput = document.getElementById("fontSizeInput");
const fontSizeValue = document.getElementById("fontSizeValue");
const showTimestampsInput = document.getElementById("showTimestampsInput");
const showTokenUsageInput = document.getElementById("showTokenUsageInput");
const timestampFormatSelect = document.getElementById("timestampFormatSelect");
const systemPromptInput = document.getElementById("systemPromptInput");
const customProviderIdInput = document.getElementById("customProviderIdInput");
const customProviderNameInput = document.getElementById("customProviderNameInput");
const customProviderEndpointInput = document.getElementById("customProviderEndpointInput");
const customProviderFormatInput = document.getElementById("customProviderFormatInput");
const customProviderImageInput = document.getElementById("customProviderImageInput");
const customProviderFields = document.getElementById("customProviderFields");
const addOptionalFieldButton = document.getElementById("addOptionalFieldButton");
const providerDetailsDialog = document.getElementById("providerDetailsDialog");
const openProviderDetailsButton = document.getElementById("openProviderDetailsButton");
const closeProviderDetailsButton = document.getElementById("closeProviderDetailsButton");
const finishProviderDetailsButton = document.getElementById("finishProviderDetailsButton");
const customProviderApiKeyInput = document.getElementById("customProviderApiKeyInput");
const customProviderModelsInput = document.getElementById("customProviderModelsInput");
const customProviderList = document.getElementById("customProviderList");
const providerListNotice = document.getElementById("providerListNotice");
const addProviderButton = document.getElementById("addProviderButton");
const providerEditorDialog = document.getElementById("providerEditorDialog");
const closeProviderEditorButton = document.getElementById("closeProviderEditorButton");
const saveCustomProviderButton = document.getElementById("saveCustomProviderButton");
const cancelCustomProviderButton = document.getElementById("cancelCustomProviderButton");
const customProviderNotice = document.getElementById("customProviderNotice");
const cleanupCacheButton = document.getElementById("cleanupCacheButton");
const clearAllDataButton = document.getElementById("clearAllDataButton");
const exportConfigButton = document.getElementById("exportConfigButton");
const importConfigButton = document.getElementById("importConfigButton");
const importConfigInput = document.getElementById("importConfigInput");
const storageNotice = document.getElementById("storageNotice");
const feedbackDialog = document.getElementById("feedbackDialog");
const feedbackDialogTitle = document.getElementById("feedbackDialogTitle");
const feedbackDialogMessage = document.getElementById("feedbackDialogMessage");
const feedbackDialogIcon = document.getElementById("feedbackDialogIcon");
const closeFeedbackDialogButton = document.getElementById("closeFeedbackDialogButton");
const confirmDialog = document.getElementById("confirmDialog");
const confirmDialogTitle = document.getElementById("confirmDialogTitle");
const confirmDialogMessage = document.getElementById("confirmDialogMessage");
const cancelConfirmDialogButton = document.getElementById("cancelConfirmDialogButton");
const acceptConfirmDialogButton = document.getElementById("acceptConfirmDialogButton");
const extensionVersion = document.getElementById("extensionVersion");
const updateDialog = document.getElementById("updateDialog");
const closeUpdateDialogButton = document.getElementById("closeUpdateDialogButton");
const updateCurrentVersion = document.getElementById("updateCurrentVersion");
const updateLatestVersion = document.getElementById("updateLatestVersion");
const updateStatus = document.getElementById("updateStatus");
const installUpdateButton = document.getElementById("installUpdateButton");
const resetSettingsButton = document.getElementById("resetSettingsButton");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const saveNotice = document.getElementById("saveNotice");

let settings = {
  activeProvider: DEFAULT_PROVIDER_ID,
  providerConfigs: createDefaultProviderConfigs(),
  theme: DEFAULT_THEME,
  ...DEFAULT_APPEARANCE_SETTINGS,
  fontSize: DEFAULT_FONT_SIZE,
  showTokenUsage: DEFAULT_SHOW_TOKEN_USAGE,
  showTimestamps: DEFAULT_SHOW_TIMESTAMPS,
  timestampFormat: DEFAULT_TIMESTAMP_FORMAT,
  systemPrompt: ""
};
let availableUpdate = null;
let resolveConfirmation = null;

function storageGet(keys) {
  return globalThis.chrome?.storage?.local ? chrome.storage.local.get(keys) : Promise.resolve({});
}

function storageSet(value) {
  return globalThis.chrome?.storage?.local ? chrome.storage.local.set(value) : Promise.resolve();
}

function normalizeTheme(value) {
  return THEMES.includes(value) ? value : DEFAULT_THEME;
}

function normalizeShowTimestamps(value) {
  return typeof value === "boolean" ? value : DEFAULT_SHOW_TIMESTAMPS;
}

function normalizeShowTokenUsage(value) {
  return typeof value === "boolean" ? value : DEFAULT_SHOW_TOKEN_USAGE;
}

function createInitialSession(messages = []) {
  const now = Date.now();
  const firstUserMessage = messages.find((message) => message?.role === "user" && typeof message.content === "string");
  const sourceTitle = firstUserMessage?.content?.trim() || "新对话";
  return {
    id: `session-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: sourceTitle.length > 24 ? `${sourceTitle.slice(0, 24)}...` : sourceTitle,
    messages,
    contextUsage: null,
    contextUsageState: messages.length > 0 ? "unavailable" : "empty",
    createdAt: now,
    updatedAt: now
  };
}

function getLegacySessions(legacyData) {
  const sessions = Array.isArray(legacyData.deepseekSessions)
    ? legacyData.deepseekSessions.filter((session) => session && typeof session.id === "string")
    : [];
  if (sessions.length > 0) return sessions;
  const messages = Array.isArray(legacyData.deepseekMessages) ? legacyData.deepseekMessages : [];
  return [createInitialSession(messages)];
}

function setNotice(element, message) {
  element.textContent = message;
  const progress = message.startsWith("正在");
  element.hidden = !progress;
  if (message && !progress) {
    const isError = /失败|无效|无法|未授予|不支持|错误|不能为空|必须|不能|缺少|超过|请至少|请选择/.test(message);
    showFeedback(message, isError ? "error" : "success");
  }
}

function setSaveNotice(message, type = "") {
  saveNotice.textContent = message;
  saveNotice.className = `save-notice${type ? ` ${type}` : ""}`;
  if (message && message !== "有未保存的更改" && message !== "所有设置均保存在本机。" && !message.startsWith("正在")) {
    showFeedback(message, type === "error" ? "error" : "success");
  }
}

function showFeedback(message, tone = "success") {
  feedbackDialog.dataset.tone = tone;
  feedbackDialogTitle.textContent = tone === "error" ? "操作未完成" : "操作完成";
  feedbackDialogIcon.textContent = tone === "error" ? "!" : "✓";
  feedbackDialogMessage.textContent = message;
  if (!feedbackDialog.open) feedbackDialog.showModal();
}

function confirmAction(message, { danger = false, title = "确认操作" } = {}) {
  if (confirmDialog.open) return Promise.resolve(false);
  confirmDialogTitle.textContent = title;
  confirmDialogMessage.textContent = message;
  confirmDialog.dataset.tone = danger ? "warning" : "";
  acceptConfirmDialogButton.className = danger ? "danger" : "primary";
  return new Promise((resolve) => {
    resolveConfirmation = resolve;
    confirmDialog.showModal();
  });
}

function finishConfirmation(accepted) {
  if (confirmDialog.open) confirmDialog.close();
  const resolve = resolveConfirmation;
  resolveConfirmation = null;
  resolve?.(accepted);
}

function autoResizeTextarea(textarea) {
  if (!textarea?.isConnected || !textarea.getClientRects().length) return;
  textarea.style.height = "auto";
  const maxHeight = Math.min(window.innerHeight * 0.4, 400);
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

closeFeedbackDialogButton.addEventListener("click", () => feedbackDialog.close());
feedbackDialog.addEventListener("click", (event) => {
  if (event.target === feedbackDialog) feedbackDialog.close();
});
cancelConfirmDialogButton.addEventListener("click", () => finishConfirmation(false));
acceptConfirmDialogButton.addEventListener("click", () => finishConfirmation(true));
confirmDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  finishConfirmation(false);
});
confirmDialog.addEventListener("click", (event) => {
  if (event.target === confirmDialog) finishConfirmation(false);
});
confirmDialog.addEventListener("close", () => {
  if (!resolveConfirmation) return;
  const resolve = resolveConfirmation;
  resolveConfirmation = null;
  resolve(false);
});
document.addEventListener("input", (event) => {
  if (event.target instanceof HTMLTextAreaElement) autoResizeTextarea(event.target);
});
window.addEventListener("resize", () => {
  for (const textarea of document.querySelectorAll("textarea")) autoResizeTextarea(textarea);
});

function setUpdateStatus(message, type = "") {
  updateStatus.textContent = message;
  updateStatus.className = `update-status${type ? ` ${type}` : ""}`;
}

async function checkForUpdates() {
  const currentManifest = chrome.runtime.getManifest();
  availableUpdate = null;
  updateCurrentVersion.textContent = currentManifest.version;
  updateLatestVersion.textContent = "检查中";
  installUpdateButton.hidden = true;
  installUpdateButton.disabled = false;
  installUpdateButton.textContent = "一键更新";
  setUpdateStatus("正在连接 GitHub 检查更新……");

  try {
    const granted = await chrome.permissions.request({ origins: [...UPDATE_PERMISSION_ORIGINS] });
    if (!granted) throw new Error("未授予访问 GitHub 的权限，无法检查更新。");
    const release = await fetchLatestVersion();
    updateLatestVersion.textContent = release.version;
    const comparison = compareVersions(release.version, currentManifest.version);
    if (comparison > 0) {
      availableUpdate = release;
      installUpdateButton.hidden = false;
      setUpdateStatus(`发现新版本 ${release.version}，可以更新本地扩展。`, "success");
    } else if (comparison === 0) {
      setUpdateStatus("当前已是最新版本。", "success");
    } else {
      setUpdateStatus("当前安装的版本比公开版本更新，无需更新。", "success");
    }
  } catch (error) {
    updateLatestVersion.textContent = "检查失败";
    setUpdateStatus(error.message || "检查更新失败，请稍后重试。", "error");
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = normalizeTheme(theme);
}

function updateRangeOutput(input, output, suffix) {
  output.textContent = `${input.value}${suffix}`;
}

function updatePresetColorSelection(color) {
  const normalizedColor = isValidHexColor(color) ? normalizeHexColor(color) : "";
  for (const button of presetColorList.querySelectorAll(".preset-color-button")) {
    button.classList.toggle("selected", button.dataset.color === normalizedColor);
  }
}

function setBackgroundColorControls(color) {
  const normalizedColor = normalizeHexColor(color);
  backgroundColorPicker.value = normalizedColor.toLowerCase();
  backgroundColorInput.value = normalizedColor;
  updatePresetColorSelection(normalizedColor);
}

function updateBackgroundImagePreview() {
  const hasImage = Boolean(settings.backgroundImage);
  backgroundImagePreview.hidden = !hasImage;
  if (hasImage) {
    backgroundImagePreviewImage.src = settings.backgroundImage;
  } else {
    backgroundImagePreviewImage.removeAttribute("src");
  }
}

function updateAppearanceControls() {
  const mode = backgroundModeSelect.value;
  solidBackgroundSettings.hidden = mode !== "solid";
  imageBackgroundSettings.hidden = mode !== "image";
  backgroundBrightnessSettings.hidden = mode !== "image";
  updateBackgroundImagePreview();
  updateRangeOutput(backgroundBrightnessInput, backgroundBrightnessValue, "%");
  updateRangeOutput(dockOpacityInput, dockOpacityValue, "%");
  updateRangeOutput(dockBlurInput, dockBlurValue, " px");
  updateRangeOutput(componentOpacityInput, componentOpacityValue, "%");
  updateRangeOutput(componentBlurInput, componentBlurValue, " px");
}

function renderPresetColors() {
  presetColorList.innerHTML = "";
  for (const color of PRESET_BACKGROUND_COLORS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-color-button";
    button.dataset.color = color;
    button.style.setProperty("--preset-color", color);
    button.setAttribute("aria-label", `使用背景颜色 ${color}`);
    button.title = color;
    presetColorList.appendChild(button);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("无法读取图片。")), { once: true });
    reader.readAsDataURL(file);
  });
}

function updateTimestampFormatControl() {
  timestampFormatSelect.disabled = !showTimestampsInput.checked;
}

function applyGlobalFontSize(value) {
  document.documentElement.style.setProperty("--global-font-size", `${normalizeFontSize(value)}px`);
}

function updateFontSizeControl(value = fontSizeInput.value) {
  const size = normalizeFontSize(value);
  fontSizeInput.value = String(size);
  fontSizeValue.textContent = `${size} px`;
  applyGlobalFontSize(size);
}

function syncFormFromSettings() {
  themeSelect.value = settings.theme;
  backgroundModeSelect.value = settings.backgroundMode;
  setBackgroundColorControls(settings.backgroundColor);
  backgroundBrightnessInput.value = String(settings.backgroundBrightness);
  dockOpacityInput.value = String(settings.dockOpacity);
  dockBlurInput.value = String(settings.dockBlur);
  componentOpacityInput.value = String(settings.componentOpacity);
  componentBlurInput.value = String(settings.componentBlur);
  fontSizeInput.value = String(settings.fontSize);
  updateFontSizeControl(settings.fontSize);
  showTokenUsageInput.checked = settings.showTokenUsage;
  showTimestampsInput.checked = settings.showTimestamps;
  timestampFormatSelect.value = settings.timestampFormat;
  systemPromptInput.value = settings.systemPrompt;
  autoResizeTextarea(systemPromptInput);
  applyTheme(settings.theme);
  updateAppearanceControls();
  updateTimestampFormatControl();
  clearCustomProviderForm();
  renderCustomProviderList();
}

function syncSettingsFromForm() {
  if (backgroundModeSelect.value === "solid" && !isValidHexColor(backgroundColorInput.value)) {
    throw new Error("背景颜色必须是六位十六进制颜色代码，例如 #F4F7FB。");
  }

  const appearance = normalizeAppearanceSettings({
    ...settings,
    backgroundMode: backgroundModeSelect.value,
    backgroundColor: backgroundColorInput.value,
    backgroundBrightness: backgroundBrightnessInput.value,
    dockOpacity: dockOpacityInput.value,
    dockBlur: dockBlurInput.value,
    componentOpacity: componentOpacityInput.value,
    componentBlur: componentBlurInput.value
  });
  if (appearance.backgroundMode === "image" && !appearance.backgroundImage) {
    throw new Error("请选择一张有效的背景图片，或改用默认/纯色背景。");
  }

  settings.theme = normalizeTheme(themeSelect.value);
  Object.assign(settings, appearance);
  settings.fontSize = normalizeFontSize(fontSizeInput.value);
  settings.showTokenUsage = showTokenUsageInput.checked;
  settings.showTimestamps = showTimestampsInput.checked;
  settings.timestampFormat = normalizeTimestampFormat(timestampFormatSelect.value);
  settings.systemPrompt = systemPromptInput.value.trim();
}

function getActiveProviderModel() {
  const profiles = getProviderProfiles(settings.providerConfigs);
  if (!profiles.some((provider) => provider.id === settings.activeProvider)) {
    settings.activeProvider = profiles[0]?.id || DEFAULT_PROVIDER_ID;
  }
  return settings.providerConfigs[settings.activeProvider]?.model
    || "";
}

async function notifySidebar(resetData = false) {
  if (!globalThis.chrome?.runtime?.sendMessage) return;
  try {
    await chrome.runtime.sendMessage({ type: "edgeChat.optionsChanged", resetData });
  } catch {
    // The sidebar is allowed to be closed while options are edited.
  }
}

async function persistPreferences() {
  const activeModel = getActiveProviderModel();
  await storageSet({
    [PREFERENCE_KEYS.theme]: settings.theme,
    [PREFERENCE_KEYS.fontSize]: settings.fontSize,
    [PREFERENCE_KEYS.backgroundMode]: settings.backgroundMode,
    [PREFERENCE_KEYS.backgroundColor]: settings.backgroundColor,
    [PREFERENCE_KEYS.backgroundBrightness]: settings.backgroundBrightness,
    [PREFERENCE_KEYS.dockOpacity]: settings.dockOpacity,
    [PREFERENCE_KEYS.dockBlur]: settings.dockBlur,
    [PREFERENCE_KEYS.componentOpacity]: settings.componentOpacity,
    [PREFERENCE_KEYS.componentBlur]: settings.componentBlur,
    [PREFERENCE_KEYS.activeProvider]: settings.activeProvider,
    [PREFERENCE_KEYS.activeModel]: activeModel,
    [PREFERENCE_KEYS.showTokenUsage]: settings.showTokenUsage,
    [PREFERENCE_KEYS.showTimestamps]: settings.showTimestamps,
    [PREFERENCE_KEYS.timestampFormat]: settings.timestampFormat,
    [PREFERENCE_KEYS.schemaVersion]: 1
  });
}

async function syncActiveSelectionFromPreferences() {
  const preferenceData = await storageGet([
    PREFERENCE_KEYS.activeProvider,
    PREFERENCE_KEYS.activeModel
  ]);
  const requestedProvider = preferenceData[PREFERENCE_KEYS.activeProvider];
  const availableProviderIds = new Set(getProviderProfiles(settings.providerConfigs).map((provider) => provider.id));
  if (availableProviderIds.has(requestedProvider)) settings.activeProvider = requestedProvider;
  if (!availableProviderIds.has(settings.activeProvider)) settings.activeProvider = [...availableProviderIds][0] || DEFAULT_PROVIDER_ID;

  const preferredModel = preferenceData[PREFERENCE_KEYS.activeModel];
  if (
    typeof preferredModel === "string"
    && getProviderProfile(settings.providerConfigs, settings.activeProvider)?.models.some((model) => model.id === preferredModel)
  ) {
    settings.providerConfigs[settings.activeProvider].model = preferredModel;
  }
}

async function persistSettings({ markUsageStale = false, preserveActiveSelection = true } = {}) {
  if (preserveActiveSelection) await syncActiveSelectionFromPreferences();
  await writeSecureConfig({
    providerConfigs: settings.providerConfigs,
    systemPrompt: settings.systemPrompt
  });
  await writeSecureBackgroundImage(settings.backgroundImage);
  if (markUsageStale) await markSecureCurrentSessionUsageStale();
  await persistPreferences();
  await notifySidebar();
}

function clearCustomProviderForm() {
  customProviderIdInput.value = "";
  customProviderNameInput.value = "";
  customProviderEndpointInput.value = "";
  customProviderFormatInput.value = "openai";
  customProviderImageInput.checked = false;
  customProviderFields.replaceChildren();
  if (providerDetailsDialog.open) providerDetailsDialog.close();
  if (providerEditorDialog.open) providerEditorDialog.close();
  customProviderApiKeyInput.value = "";
  customProviderModelsInput.value = "";
  saveCustomProviderButton.textContent = "添加提供商";
  document.getElementById("providerEditorTitle").textContent = "添加提供商";
  setNotice(customProviderNotice, "");
}

function renderCustomProviderList() {
  customProviderList.innerHTML = "";
  setNotice(providerListNotice, "");
  const providers = Object.values(settings.providerConfigs).filter((config) => config.type === "custom");
  if (providers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "custom-provider-empty";
    empty.textContent = "尚未添加自定义提供商";
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
    endpoint.textContent = `${provider.apiFormat === "anthropic" ? "Anthropic" : "OpenAI"} · ${provider.baseUrl}`;
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

function addOptionalFieldRow(field = { key: "", value: "" }) {
  const row = document.createElement("div");
  row.className = "optional-field-row";
  const key = document.createElement("input");
  key.type = "text";
  key.placeholder = "字段名，例如 temperature";
  key.setAttribute("aria-label", "POST 字段名");
  key.value = field.key;
  const value = document.createElement("textarea");
  value.rows = 1;
  value.placeholder = 'JSON 值，例如 0.7 或 "auto"';
  value.setAttribute("aria-label", "JSON 字段值");
  value.value = field.value;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ghost";
  remove.textContent = "移除";
  remove.addEventListener("click", () => row.remove());
  row.append(key, value, remove);
  customProviderFields.appendChild(row);
  autoResizeTextarea(value);
}

function readOptionalFields() {
  return [...customProviderFields.querySelectorAll(".optional-field-row")].map((row) => ({
    key: row.children[0].value.trim(), value: row.children[1].value.trim()
  }));
}

addOptionalFieldButton.addEventListener("click", () => addOptionalFieldRow());
openProviderDetailsButton.addEventListener("click", () => {
  providerDetailsDialog.showModal();
  for (const textarea of customProviderFields.querySelectorAll("textarea")) autoResizeTextarea(textarea);
});
closeProviderDetailsButton.addEventListener("click", () => providerDetailsDialog.close());
finishProviderDetailsButton.addEventListener("click", () => providerDetailsDialog.close());
addProviderButton.addEventListener("click", () => {
  clearCustomProviderForm();
  providerEditorDialog.showModal();
  autoResizeTextarea(customProviderModelsInput);
  customProviderNameInput.focus();
});
closeProviderEditorButton.addEventListener("click", clearCustomProviderForm);

async function removeOriginPermissionIfUnused(permissionOrigin) {
  if (!permissionOrigin || !globalThis.chrome?.permissions) return;
  const stillUsed = Object.values(settings.providerConfigs).some((config) => (
    config.type === "custom" && config.permissionOrigin === permissionOrigin
  ));
  if (!stillUsed) await chrome.permissions.remove({ origins: [permissionOrigin] });
}

async function loadSettings() {
  const [preferenceData, legacyData] = await Promise.all([
    storageGet(Object.values(PREFERENCE_KEYS)),
    readLegacyStorage()
  ]);
  let secureState = await readSecureState();
  let migrated = false;

  if (!secureState) {
    const sessions = getLegacySessions(legacyData);
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
    if (!secureState || secureState.sessions.length !== sessions.length) {
      throw new Error("旧版数据迁移验证失败，明文数据仍已保留，请重新打开拓展选项后重试。");
    }
    migrated = true;
  }

  const providerConfigs = normalizeProviderConfigs(secureState.config.providerConfigs);
  const availableProviderIds = new Set(getProviderProfiles(providerConfigs).map((provider) => provider.id));
  const requestedProvider = preferenceData[PREFERENCE_KEYS.activeProvider]
    || legacyData.activeModelProvider
    || DEFAULT_PROVIDER_ID;
  const activeProvider = availableProviderIds.has(requestedProvider) ? requestedProvider : [...availableProviderIds][0] || DEFAULT_PROVIDER_ID;
  const preferredModel = preferenceData[PREFERENCE_KEYS.activeModel];
  if (
    typeof preferredModel === "string"
    && getProviderProfile(providerConfigs, activeProvider)?.models.some((model) => model.id === preferredModel)
  ) {
    providerConfigs[activeProvider].model = preferredModel;
  }

  settings = {
    activeProvider,
    providerConfigs,
    theme: normalizeTheme(preferenceData[PREFERENCE_KEYS.theme] || legacyData.deepseekTheme),
    ...normalizeAppearanceSettings({
      backgroundMode: preferenceData[PREFERENCE_KEYS.backgroundMode],
      backgroundColor: preferenceData[PREFERENCE_KEYS.backgroundColor],
      backgroundImage: await readSecureBackgroundImage(),
      backgroundBrightness: preferenceData[PREFERENCE_KEYS.backgroundBrightness],
      dockOpacity: preferenceData[PREFERENCE_KEYS.dockOpacity],
      dockBlur: preferenceData[PREFERENCE_KEYS.dockBlur],
      componentOpacity: preferenceData[PREFERENCE_KEYS.componentOpacity],
      componentBlur: preferenceData[PREFERENCE_KEYS.componentBlur],
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
    systemPrompt: typeof secureState.config.systemPrompt === "string" ? secureState.config.systemPrompt : ""
  };

  syncFormFromSettings();
  if (migrated) {
    await persistSettings();
    await removeLegacyStorage();
    await garbageCollectSecureStore();
  }
  setSaveNotice("所有设置均保存在本机。", "");
}

themeSelect.addEventListener("change", () => {
  applyTheme(themeSelect.value);
  setSaveNotice("有未保存的更改");
});

backgroundModeSelect.addEventListener("change", () => {
  updateAppearanceControls();
  setSaveNotice("有未保存的更改");
});

presetColorList.addEventListener("click", (event) => {
  const button = event.target.closest(".preset-color-button");
  if (!button) return;
  setBackgroundColorControls(button.dataset.color);
  setSaveNotice("有未保存的更改");
});

backgroundColorPicker.addEventListener("input", () => {
  setBackgroundColorControls(backgroundColorPicker.value);
  setSaveNotice("有未保存的更改");
});

backgroundColorInput.addEventListener("input", () => {
  if (isValidHexColor(backgroundColorInput.value)) {
    const color = normalizeHexColor(backgroundColorInput.value);
    backgroundColorPicker.value = color.toLowerCase();
    updatePresetColorSelection(color);
  } else {
    updatePresetColorSelection("");
  }
  setSaveNotice("有未保存的更改");
});

backgroundImageInput.addEventListener("change", async () => {
  const [file] = backgroundImageInput.files || [];
  if (!file) return;
  if (!SUPPORTED_BACKGROUND_IMAGE_TYPES.includes(file.type)) {
    backgroundImageInput.value = "";
    setSaveNotice("不支持该图片格式，请选择 PNG、JPEG、WebP、GIF 或 AVIF。", "error");
    return;
  }
  if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
    backgroundImageInput.value = "";
    setSaveNotice("背景图片不能超过 10 MB。", "error");
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const normalizedImage = normalizeBackgroundImage(dataUrl);
    if (!normalizedImage) throw new Error("图片内容无效或尺寸超过限制。");
    settings.backgroundImage = normalizedImage;
    backgroundModeSelect.value = "image";
    updateAppearanceControls();
    setSaveNotice("背景图片已载入，保存设置后应用到侧栏。");
  } catch (error) {
    backgroundImageInput.value = "";
    setSaveNotice(`读取背景图片失败：${error.message}`, "error");
  }
});

removeBackgroundImageButton.addEventListener("click", () => {
  settings.backgroundImage = "";
  backgroundImageInput.value = "";
  backgroundModeSelect.value = "default";
  updateAppearanceControls();
  setSaveNotice("背景图片已移除，并已切换为主题默认背景；保存设置后生效。");
});

for (const [input, output, suffix] of [
  [backgroundBrightnessInput, backgroundBrightnessValue, "%"],
  [dockOpacityInput, dockOpacityValue, "%"],
  [dockBlurInput, dockBlurValue, " px"],
  [componentOpacityInput, componentOpacityValue, "%"],
  [componentBlurInput, componentBlurValue, " px"]
]) {
  input.addEventListener("input", () => {
    updateRangeOutput(input, output, suffix);
    setSaveNotice("有未保存的更改");
  });
}

fontSizeInput.addEventListener("input", () => {
  updateFontSizeControl();
  setSaveNotice("有未保存的更改");
});

showTimestampsInput.addEventListener("change", () => {
  updateTimestampFormatControl();
  setSaveNotice("有未保存的更改");
});

showTokenUsageInput.addEventListener("change", () => {
  setSaveNotice("有未保存的更改");
});

for (const element of [timestampFormatSelect, systemPromptInput]) {
  element.addEventListener("input", () => setSaveNotice("有未保存的更改"));
  element.addEventListener("change", () => setSaveNotice("有未保存的更改"));
}

saveSettingsButton.addEventListener("click", async () => {
  saveSettingsButton.disabled = true;
  setSaveNotice("正在保存……");
  try {
    const previousSystemPrompt = settings.systemPrompt;
    const latestConfig = await readSecureConfig();
    if (latestConfig?.providerConfigs) {
      settings.providerConfigs = normalizeProviderConfigs(latestConfig.providerConfigs);
    }
    syncSettingsFromForm();
    await persistSettings({ markUsageStale: previousSystemPrompt !== settings.systemPrompt });
    setSaveNotice("设置已保存，并已同步到侧栏。", "success");
  } catch (error) {
    setSaveNotice(`保存失败：${error.message}`, "error");
  } finally {
    saveSettingsButton.disabled = false;
  }
});

resetSettingsButton.addEventListener("click", async () => {
  const confirmed = await confirmAction("确定要重置设置吗？API Key、提供商、主题背景、透明与模糊效果、全局字号、Token 用量显示、时间戳、系统提示词和模型选择会恢复默认，历史对话会保留。", { danger: true, title: "重置设置" });
  if (!confirmed) return;

  resetSettingsButton.disabled = true;
  const customOrigins = [...new Set(Object.values(settings.providerConfigs)
    .filter((config) => config.type === "custom")
    .map((config) => config.permissionOrigin))];
  settings = {
    activeProvider: DEFAULT_PROVIDER_ID,
    providerConfigs: createDefaultProviderConfigs(),
      theme: DEFAULT_THEME,
    ...DEFAULT_APPEARANCE_SETTINGS,
    fontSize: DEFAULT_FONT_SIZE,
    showTokenUsage: DEFAULT_SHOW_TOKEN_USAGE,
    showTimestamps: DEFAULT_SHOW_TIMESTAMPS,
    timestampFormat: DEFAULT_TIMESTAMP_FORMAT,
    systemPrompt: ""
  };
  syncFormFromSettings();

  try {
    await persistSettings({ markUsageStale: true, preserveActiveSelection: false });
    if (globalThis.chrome?.permissions && customOrigins.length > 0) {
      await chrome.permissions.remove({ origins: customOrigins });
    }
    setSaveNotice("设置已重置，历史对话保持不变。", "success");
  } catch (error) {
    setSaveNotice(`重置失败：${error.message}`, "error");
  } finally {
    resetSettingsButton.disabled = false;
  }
});

saveCustomProviderButton.addEventListener("click", async () => {
  setNotice(customProviderNotice, "");
  const existingId = customProviderIdInput.value;
  const existing = settings.providerConfigs[existingId];
  let provider;
  try {
    provider = normalizeCustomProvider({
      ...existing,
      label: customProviderNameInput.value,
      baseUrl: customProviderEndpointInput.value,
      apiFormat: customProviderFormatInput.value,
      imageInput: customProviderImageInput.checked,
      optionalFields: readOptionalFields(),
      apiKey: customProviderApiKeyInput.value,
      models: customProviderModelsInput.value,
      model: existing?.model,
    }, existingId);
  } catch (error) {
    setNotice(customProviderNotice, error.message);
    return;
  }

  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [provider.permissionOrigin] });
  } catch (error) {
    setNotice(customProviderNotice, `无法申请 ${provider.origin} 的访问权限：${error.message}`);
    return;
  }
  if (!granted) {
    setNotice(customProviderNotice, `未授予 ${provider.origin} 的访问权限。配置未保存，完整对话上下文和 API Key 均不会发送。`);
    return;
  }

  saveCustomProviderButton.disabled = true;
  try {
    const latestConfig = await readSecureConfig();
    const latestProviderConfigs = normalizeProviderConfigs(latestConfig?.providerConfigs);
    const latestExisting = latestProviderConfigs[existingId];
    provider = normalizeCustomProvider({
      ...provider
    }, existingId);
    const previousOrigin = latestExisting?.permissionOrigin || existing?.permissionOrigin;
    settings.providerConfigs = normalizeProviderConfigs({
      ...latestProviderConfigs,
      [provider.id]: provider
    });
    await persistSettings();
    if (previousOrigin && previousOrigin !== provider.permissionOrigin) {
      await removeOriginPermissionIfUnused(previousOrigin);
    }
    clearCustomProviderForm();
    renderCustomProviderList();
    setNotice(providerListNotice, `已保存提供商“${provider.label}”。`);
  } catch (error) {
    setNotice(customProviderNotice, `保存失败：${error.message}`);
  } finally {
    saveCustomProviderButton.disabled = false;
  }
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
    customProviderEndpointInput.value = provider.baseUrl;
    customProviderFormatInput.value = provider.apiFormat;
    customProviderImageInput.checked = provider.imageInput;
    customProviderFields.replaceChildren();
    for (const field of provider.optionalFields) addOptionalFieldRow(field);
    customProviderApiKeyInput.value = provider.apiKey;
    customProviderModelsInput.value = provider.models.map((model) => model.id).join("\n");
    saveCustomProviderButton.textContent = "保存提供商";
    document.getElementById("providerEditorTitle").textContent = `编辑 ${provider.label}`;
    setNotice(customProviderNotice, "");
    setNotice(providerListNotice, "");
    providerEditorDialog.showModal();
    autoResizeTextarea(customProviderModelsInput);
    customProviderNameInput.focus();
    return;
  }

  if (!await confirmAction(`确定删除自定义提供商“${provider.label}”吗？历史对话不会删除。`, { danger: true, title: "删除提供商" })) return;
  deleteButton.disabled = true;
  try {
    const latestConfig = await readSecureConfig();
    settings.providerConfigs = normalizeProviderConfigs(latestConfig?.providerConfigs);
    const latestProvider = settings.providerConfigs[provider.id];
    if (!latestProvider || latestProvider.type !== "custom") {
      renderCustomProviderList();
      setNotice(providerListNotice, "该提供商已被删除。");
      return;
    }
    delete settings.providerConfigs[latestProvider.id];
    if (settings.activeProvider === provider.id) settings.activeProvider = Object.keys(settings.providerConfigs)[0] || DEFAULT_PROVIDER_ID;
    await persistSettings();
    await removeOriginPermissionIfUnused(latestProvider.permissionOrigin);
    if (customProviderIdInput.value === provider.id) clearCustomProviderForm();
    renderCustomProviderList();
    setNotice(providerListNotice, `已删除提供商“${provider.label}”。`);
  } catch (error) {
    settings.providerConfigs[provider.id] = provider;
    renderCustomProviderList();
    setNotice(providerListNotice, `删除失败：${error.message}`);
  }
});

exportConfigButton.addEventListener("click", async () => {
  exportConfigButton.disabled = true;
  setNotice(storageNotice, "正在生成配置文件……");
  try {
    syncSettingsFromForm();
    const [secureConfig, preferenceData] = await Promise.all([
      readSecureConfig(),
      storageGet([PREFERENCE_KEYS.activeProvider, PREFERENCE_KEYS.activeModel])
    ]);
    const exportSettings = {
      ...settings,
      providerConfigs: normalizeProviderConfigs(secureConfig?.providerConfigs ?? settings.providerConfigs)
    };
    const preferredProvider = preferenceData[PREFERENCE_KEYS.activeProvider];
    if (Object.hasOwn(exportSettings.providerConfigs, preferredProvider)) {
      exportSettings.activeProvider = preferredProvider;
      const preferredModel = preferenceData[PREFERENCE_KEYS.activeModel];
      if (exportSettings.providerConfigs[preferredProvider].models.some((model) => model.id === preferredModel)) {
        exportSettings.providerConfigs[preferredProvider].model = preferredModel;
      }
    }
    const archive = createConfigArchive(exportSettings);
    const blob = new Blob([`${JSON.stringify(archive, null, 2)}\n`], { type: "application/json" });
    if (blob.size > 24 * 1024 * 1024) throw new Error("配置文件超过 24 MB，无法导出。");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `edge-chat-sidebar-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(storageNotice, "配置文件已导出。API Key 与历史对话未包含在文件中。");
  } catch (error) {
    setNotice(storageNotice, `导出失败：${error.message}`);
  } finally {
    exportConfigButton.disabled = false;
  }
});

importConfigButton.addEventListener("click", () => {
  importConfigInput.value = "";
  importConfigInput.click();
});

importConfigInput.addEventListener("change", async () => {
  const [file] = importConfigInput.files || [];
  if (!file) return;
  importConfigButton.disabled = true;
  try {
    if (file.size > 24 * 1024 * 1024) throw new Error("配置文件不能超过 24 MB。");
    const currentConfig = await readSecureConfig();
    const imported = parseConfigArchive(await file.text(), currentConfig?.providerConfigs);
    const confirmed = await confirmAction(
      `导入 ${Object.keys(imported.providerConfigs).length} 个提供商的配置？这会替换当前提供商列表和界面设置，历史对话保持不变。只有 ID、地址与格式均相同的已有提供商会保留本机 API Key。`,
      { title: "导入配置" }
    );
    if (!confirmed) return;
    const previousSettings = settings;
    settings = imported;
    syncFormFromSettings();
    try {
      await persistSettings({ markUsageStale: true, preserveActiveSelection: false });
    } catch (error) {
      settings = previousSettings;
      syncFormFromSettings();
      throw error;
    }
    setSaveNotice("配置已导入并保存。", "success");
    setNotice(storageNotice, "配置已导入并同步到侧栏。如有新提供商，请补填 API Key。");
  } catch (error) {
    setNotice(storageNotice, `导入失败：${error.message}`);
  } finally {
    importConfigInput.value = "";
    importConfigButton.disabled = false;
  }
});

cleanupCacheButton.addEventListener("click", async () => {
  cleanupCacheButton.disabled = true;
  setNotice(storageNotice, "正在检查孤儿缓存……");
  try {
    const result = await garbageCollectSecureStore();
    setNotice(
      storageNotice,
      `已删除 ${result.sessions} 个孤儿会话、${result.images} 张孤儿图片和 ${result.temporary} 条临时记录，释放约 ${formatReleasedBytes(result.releasedBytes)}。`
    );
  } catch (error) {
    setNotice(storageNotice, `清理失败：${error.message}`);
  } finally {
    cleanupCacheButton.disabled = false;
  }
});

clearAllDataButton.addEventListener("click", async () => {
  const confirmed = await confirmAction("这会永久删除全部 API Key、自定义提供商、系统提示词、历史对话和图片。确定继续吗？", { danger: true, title: "清空全部数据" });
  if (!confirmed) return;
  clearAllDataButton.disabled = true;
  setNotice(storageNotice, "正在清空全部本地数据……");
  try {
    await clearAllLocalData();
    await notifySidebar(true);
    location.reload();
  } catch (error) {
    setNotice(storageNotice, `清空失败：${error.message}`);
    clearAllDataButton.disabled = false;
  }
});

extensionVersion.addEventListener("click", () => {
  if (!updateDialog.open) updateDialog.showModal();
  checkForUpdates();
});

closeUpdateDialogButton.addEventListener("click", () => updateDialog.close());

updateDialog.addEventListener("click", (event) => {
  if (event.target === updateDialog && !installUpdateButton.disabled) updateDialog.close();
});

updateDialog.addEventListener("cancel", (event) => {
  if (installUpdateButton.disabled) event.preventDefault();
});

installUpdateButton.addEventListener("click", async () => {
  if (!availableUpdate) return;
  if (typeof window.showDirectoryPicker !== "function") {
    setUpdateStatus("当前 Edge 版本不支持写入本地扩展目录，请升级浏览器后重试。", "error");
    return;
  }

  let directoryHandle;
  try {
    directoryHandle = await window.showDirectoryPicker({
      id: "edge-chat-sidebar-update",
      mode: "readwrite"
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      setUpdateStatus("已取消选择，未更改本地版本。");
      return;
    }
    setUpdateStatus(`无法打开扩展文件夹：${error.message}`, "error");
    return;
  }

  installUpdateButton.disabled = true;
  closeUpdateDialogButton.disabled = true;
  try {
    await installLocalUpdate({
      directoryHandle,
      release: availableUpdate,
      currentManifest: chrome.runtime.getManifest(),
      onProgress: (message) => setUpdateStatus(message)
    });
    updateCurrentVersion.textContent = availableUpdate.version;
    installUpdateButton.textContent = "更新完成";
    setUpdateStatus(`已更新到 ${availableUpdate.version}，正在重新加载扩展……`, "success");
    setTimeout(() => chrome.runtime.reload(), 900);
  } catch (error) {
    setUpdateStatus(error.message || "更新失败，请稍后重试。", "error");
    installUpdateButton.disabled = false;
    closeUpdateDialogButton.disabled = false;
  }
});

extensionVersion.textContent = chrome.runtime.getManifest().version;
renderPresetColors();

loadSettings().catch((error) => {
  setSaveNotice(`初始化失败：${error.message}`, "error");
  setNotice(storageNotice, `${error.message} 如无法恢复，请尝试清空全部本地数据。`);
});
