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

const DEFAULT_THEME = "system";
const DEFAULT_WEB_SEARCH_MODE = "off";
const THEMES = ["system", "light", "dark"];
const WEB_SEARCH_MODES = ["off", "auto", "force"];

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
const composerOpacityInput = document.getElementById("composerOpacityInput");
const composerOpacityValue = document.getElementById("composerOpacityValue");
const composerBlurInput = document.getElementById("composerBlurInput");
const composerBlurValue = document.getElementById("composerBlurValue");
const statusbarOpacityInput = document.getElementById("statusbarOpacityInput");
const statusbarOpacityValue = document.getElementById("statusbarOpacityValue");
const statusbarBlurInput = document.getElementById("statusbarBlurInput");
const statusbarBlurValue = document.getElementById("statusbarBlurValue");
const fontSizeInput = document.getElementById("fontSizeInput");
const fontSizeValue = document.getElementById("fontSizeValue");
const showTimestampsInput = document.getElementById("showTimestampsInput");
const timestampFormatSelect = document.getElementById("timestampFormatSelect");
const systemPromptInput = document.getElementById("systemPromptInput");
const webSearchModeSelect = document.getElementById("webSearchModeSelect");
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
const extensionVersion = document.getElementById("extensionVersion");
const resetSettingsButton = document.getElementById("resetSettingsButton");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const saveNotice = document.getElementById("saveNotice");

let settings = {
  activeProvider: DEFAULT_PROVIDER_ID,
  providerConfigs: createDefaultProviderConfigs(),
  webSearchMode: DEFAULT_WEB_SEARCH_MODE,
  theme: DEFAULT_THEME,
  ...DEFAULT_APPEARANCE_SETTINGS,
  fontSize: DEFAULT_FONT_SIZE,
  showTimestamps: DEFAULT_SHOW_TIMESTAMPS,
  timestampFormat: DEFAULT_TIMESTAMP_FORMAT,
  systemPrompt: ""
};

function storageGet(keys) {
  return globalThis.chrome?.storage?.local ? chrome.storage.local.get(keys) : Promise.resolve({});
}

function storageSet(value) {
  return globalThis.chrome?.storage?.local ? chrome.storage.local.set(value) : Promise.resolve();
}

function normalizeTheme(value) {
  return THEMES.includes(value) ? value : DEFAULT_THEME;
}

function normalizeWebSearchMode(value) {
  return WEB_SEARCH_MODES.includes(value) ? value : DEFAULT_WEB_SEARCH_MODE;
}

function normalizeShowTimestamps(value) {
  return typeof value === "boolean" ? value : DEFAULT_SHOW_TIMESTAMPS;
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
  element.hidden = !message;
}

function setSaveNotice(message, type = "") {
  saveNotice.textContent = message;
  saveNotice.className = `save-notice${type ? ` ${type}` : ""}`;
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
  updateRangeOutput(composerOpacityInput, composerOpacityValue, "%");
  updateRangeOutput(composerBlurInput, composerBlurValue, " px");
  updateRangeOutput(statusbarOpacityInput, statusbarOpacityValue, "%");
  updateRangeOutput(statusbarBlurInput, statusbarBlurValue, " px");
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
  composerOpacityInput.value = String(settings.composerOpacity);
  composerBlurInput.value = String(settings.composerBlur);
  statusbarOpacityInput.value = String(settings.statusbarOpacity);
  statusbarBlurInput.value = String(settings.statusbarBlur);
  fontSizeInput.value = String(settings.fontSize);
  updateFontSizeControl(settings.fontSize);
  showTimestampsInput.checked = settings.showTimestamps;
  timestampFormatSelect.value = settings.timestampFormat;
  systemPromptInput.value = settings.systemPrompt;
  webSearchModeSelect.value = settings.webSearchMode;
  deepseekApiKeyInput.value = settings.providerConfigs.deepseek.apiKey;
  mimoApiKeyInput.value = settings.providerConfigs.mimo.apiKey;
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
    composerOpacity: composerOpacityInput.value,
    composerBlur: composerBlurInput.value,
    statusbarOpacity: statusbarOpacityInput.value,
    statusbarBlur: statusbarBlurInput.value
  });
  if (appearance.backgroundMode === "image" && !appearance.backgroundImage) {
    throw new Error("请选择一张有效的背景图片，或改用默认/纯色背景。");
  }

  settings.providerConfigs = normalizeProviderConfigs({
    ...settings.providerConfigs,
    deepseek: {
      ...settings.providerConfigs.deepseek,
      apiKey: deepseekApiKeyInput.value.trim()
    },
    mimo: {
      ...settings.providerConfigs.mimo,
      apiKey: mimoApiKeyInput.value.trim()
    }
  });
  settings.theme = normalizeTheme(themeSelect.value);
  Object.assign(settings, appearance);
  settings.fontSize = normalizeFontSize(fontSizeInput.value);
  settings.showTimestamps = showTimestampsInput.checked;
  settings.timestampFormat = normalizeTimestampFormat(timestampFormatSelect.value);
  settings.systemPrompt = systemPromptInput.value.trim();
  settings.webSearchMode = normalizeWebSearchMode(webSearchModeSelect.value);
}

function getActiveProviderModel() {
  const profiles = getProviderProfiles(settings.providerConfigs);
  if (!profiles.some((provider) => provider.id === settings.activeProvider)) {
    settings.activeProvider = DEFAULT_PROVIDER_ID;
  }
  return settings.providerConfigs[settings.activeProvider]?.model
    || settings.providerConfigs[DEFAULT_PROVIDER_ID].model;
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
  await storageSet({
    [PREFERENCE_KEYS.theme]: settings.theme,
    [PREFERENCE_KEYS.fontSize]: settings.fontSize,
    [PREFERENCE_KEYS.backgroundMode]: settings.backgroundMode,
    [PREFERENCE_KEYS.backgroundColor]: settings.backgroundColor,
    [PREFERENCE_KEYS.backgroundBrightness]: settings.backgroundBrightness,
    [PREFERENCE_KEYS.composerOpacity]: settings.composerOpacity,
    [PREFERENCE_KEYS.composerBlur]: settings.composerBlur,
    [PREFERENCE_KEYS.statusbarOpacity]: settings.statusbarOpacity,
    [PREFERENCE_KEYS.statusbarBlur]: settings.statusbarBlur,
    [PREFERENCE_KEYS.activeProvider]: settings.activeProvider,
    [PREFERENCE_KEYS.activeModel]: getActiveProviderModel(),
    [PREFERENCE_KEYS.webSearchMode]: settings.webSearchMode,
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

  const preferredModel = preferenceData[PREFERENCE_KEYS.activeModel];
  if (
    typeof preferredModel === "string"
    && getProviderProfile(settings.providerConfigs, settings.activeProvider).models.some((model) => model.id === preferredModel)
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
  customProviderApiKeyInput.value = "";
  customProviderModelsInput.value = "";
  saveCustomProviderButton.textContent = "添加提供商";
  cancelCustomProviderButton.hidden = true;
  setNotice(customProviderNotice, "");
}

function renderCustomProviderList() {
  customProviderList.innerHTML = "";
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
  const activeProvider = availableProviderIds.has(requestedProvider) ? requestedProvider : DEFAULT_PROVIDER_ID;
  const preferredModel = preferenceData[PREFERENCE_KEYS.activeModel];
  if (
    typeof preferredModel === "string"
    && getProviderProfile(providerConfigs, activeProvider).models.some((model) => model.id === preferredModel)
  ) {
    providerConfigs[activeProvider].model = preferredModel;
  }

  settings = {
    activeProvider,
    providerConfigs,
    webSearchMode: normalizeWebSearchMode(
      preferenceData[PREFERENCE_KEYS.webSearchMode]
        ?? legacyData["edgeChat.mimoWebSearchMode"]
        ?? legacyData.mimoWebSearchMode
    ),
    theme: normalizeTheme(preferenceData[PREFERENCE_KEYS.theme] || legacyData.deepseekTheme),
    ...normalizeAppearanceSettings({
      backgroundMode: preferenceData[PREFERENCE_KEYS.backgroundMode],
      backgroundColor: preferenceData[PREFERENCE_KEYS.backgroundColor],
      backgroundImage: await readSecureBackgroundImage(),
      backgroundBrightness: preferenceData[PREFERENCE_KEYS.backgroundBrightness],
      composerOpacity: preferenceData[PREFERENCE_KEYS.composerOpacity],
      composerBlur: preferenceData[PREFERENCE_KEYS.composerBlur],
      statusbarOpacity: preferenceData[PREFERENCE_KEYS.statusbarOpacity],
      statusbarBlur: preferenceData[PREFERENCE_KEYS.statusbarBlur]
    }),
    fontSize: normalizeFontSize(
      preferenceData[PREFERENCE_KEYS.fontSize] ?? legacyData["edgeChat.messageFontSize"]
    ),
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
  [composerOpacityInput, composerOpacityValue, "%"],
  [composerBlurInput, composerBlurValue, " px"],
  [statusbarOpacityInput, statusbarOpacityValue, "%"],
  [statusbarBlurInput, statusbarBlurValue, " px"]
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

for (const element of [timestampFormatSelect, systemPromptInput, webSearchModeSelect, deepseekApiKeyInput, mimoApiKeyInput]) {
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
  const confirmed = window.confirm("确定要重置设置吗？API Key、自定义提供商、主题背景、透明与模糊效果、全局字号、时间戳、系统提示词、联网搜索和模型选择会恢复默认，历史对话会保留。");
  if (!confirmed) return;

  resetSettingsButton.disabled = true;
  const customOrigins = [...new Set(Object.values(settings.providerConfigs)
    .filter((config) => config.type === "custom")
    .map((config) => config.permissionOrigin))];
  settings = {
    activeProvider: DEFAULT_PROVIDER_ID,
    providerConfigs: createDefaultProviderConfigs(),
    webSearchMode: DEFAULT_WEB_SEARCH_MODE,
    theme: DEFAULT_THEME,
    ...DEFAULT_APPEARANCE_SETTINGS,
    fontSize: DEFAULT_FONT_SIZE,
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
      endpoint: customProviderEndpointInput.value,
      apiKey: customProviderApiKeyInput.value,
      models: customProviderModelsInput.value,
      model: existing?.model,
      capabilityCache: existing?.endpoint === customProviderEndpointInput.value.trim()
        ? existing.capabilityCache
        : undefined
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
      ...provider,
      capabilityCache: latestExisting?.endpoint === provider.endpoint
        ? latestExisting.capabilityCache
        : provider.capabilityCache
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
    setNotice(customProviderNotice, `已保存自定义提供商“${provider.label}”。`);
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
    customProviderEndpointInput.value = provider.endpoint;
    customProviderApiKeyInput.value = provider.apiKey;
    customProviderModelsInput.value = provider.models.map((model) => model.id).join("\n");
    saveCustomProviderButton.textContent = "保存提供商";
    cancelCustomProviderButton.hidden = false;
    setNotice(customProviderNotice, "");
    customProviderNameInput.focus();
    return;
  }

  if (!window.confirm(`确定删除自定义提供商“${provider.label}”吗？历史对话不会删除。`)) return;
  deleteButton.disabled = true;
  try {
    const latestConfig = await readSecureConfig();
    settings.providerConfigs = normalizeProviderConfigs(latestConfig?.providerConfigs);
    const latestProvider = settings.providerConfigs[provider.id];
    if (!latestProvider || latestProvider.type !== "custom") {
      renderCustomProviderList();
      setNotice(customProviderNotice, "该自定义提供商已被删除。");
      return;
    }
    delete settings.providerConfigs[latestProvider.id];
    if (settings.activeProvider === provider.id) settings.activeProvider = DEFAULT_PROVIDER_ID;
    await persistSettings();
    await removeOriginPermissionIfUnused(latestProvider.permissionOrigin);
    if (customProviderIdInput.value === provider.id) clearCustomProviderForm();
    renderCustomProviderList();
    setNotice(customProviderNotice, `已删除自定义提供商“${provider.label}”。`);
  } catch (error) {
    settings.providerConfigs[provider.id] = provider;
    renderCustomProviderList();
    setNotice(customProviderNotice, `删除失败：${error.message}`);
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
  const confirmed = window.confirm("这会永久删除全部 API Key、自定义提供商、系统提示词、历史对话和图片。确定继续吗？");
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

extensionVersion.textContent = chrome.runtime.getManifest().version;
renderPresetColors();

loadSettings().catch((error) => {
  setSaveNotice(`初始化失败：${error.message}`, "error");
  setNotice(storageNotice, `${error.message} 如无法恢复，请尝试清空全部本地数据。`);
});
