import {
  DEFAULT_PROVIDER_ID,
  normalizeCustomProvider,
  normalizeProviderConfigs
} from "./providers.js";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  normalizeAppearanceSettings
} from "./appearance.js";
import { DEFAULT_FONT_SIZE, normalizeFontSize } from "./font-size.js";
import {
  DEFAULT_SHOW_TIMESTAMPS,
  DEFAULT_TIMESTAMP_FORMAT,
  normalizeTimestampFormat
} from "./message-timestamps.js";

export const CONFIG_FILE_FORMAT = "edge-chat-sidebar-config";
export const CONFIG_FILE_VERSION = 1;

const APPEARANCE_FIELDS = [
  "backgroundMode", "backgroundColor", "backgroundImage", "backgroundBrightness",
  "dockOpacity", "dockBlur", "componentOpacity", "componentBlur"
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exportProvider(provider) {
  return {
    id: provider.id,
    label: provider.label,
    apiFormat: provider.apiFormat,
    baseUrl: provider.baseUrl,
    models: provider.models.map((model) => model.id),
    model: provider.model,
    optionalFields: provider.optionalFields.map(({ key, value }) => ({ key, value })),
    imageInput: provider.imageInput
  };
}

export function createConfigArchive(settings) {
  const appearance = normalizeAppearanceSettings(settings);
  const providers = Object.values(normalizeProviderConfigs(settings.providerConfigs)).map(exportProvider);
  return {
    format: CONFIG_FILE_FORMAT,
    version: CONFIG_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      providers,
      activeProvider: settings.activeProvider || DEFAULT_PROVIDER_ID,
      theme: ["system", "light", "dark"].includes(settings.theme) ? settings.theme : "system",
      ...Object.fromEntries(APPEARANCE_FIELDS.map((field) => [field, appearance[field]])),
      fontSize: normalizeFontSize(settings.fontSize),
      showTokenUsage: settings.showTokenUsage !== false,
      showTimestamps: settings.showTimestamps !== false,
      timestampFormat: normalizeTimestampFormat(settings.timestampFormat),
      systemPrompt: typeof settings.systemPrompt === "string" ? settings.systemPrompt : ""
    }
  };
}

export function parseConfigArchive(text, existingProviderConfigs = {}) {
  let archive;
  try {
    archive = JSON.parse(text);
  } catch {
    throw new Error("配置文件不是有效的 JSON。");
  }
  if (!isRecord(archive) || archive.format !== CONFIG_FILE_FORMAT || archive.version !== CONFIG_FILE_VERSION) {
    throw new Error("配置文件格式或版本不受支持。");
  }
  const source = archive.settings;
  if (!isRecord(source) || !Array.isArray(source.providers) || source.providers.length > 100) {
    throw new Error("配置文件缺少有效的提供商列表。");
  }
  const requiredSettings = [
    "activeProvider", "theme", "backgroundMode", "backgroundColor", "backgroundImage",
    "backgroundBrightness", "dockOpacity", "dockBlur", "componentOpacity", "componentBlur",
    "fontSize", "showTokenUsage", "showTimestamps", "timestampFormat", "systemPrompt"
  ];
  if (requiredSettings.some((key) => !Object.hasOwn(source, key))) {
    throw new Error("配置文件缺少必要设置，无法完整导入。");
  }

  const currentProviders = normalizeProviderConfigs(existingProviderConfigs);
  const providerEntries = source.providers.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string"
      || !/^[A-Za-z0-9_-]{1,100}$/.test(item.id)
      || ["__proto__", "prototype", "constructor"].includes(item.id)) {
      throw new Error("配置文件包含无效的提供商 ID。");
    }
    let provider;
    try {
      provider = normalizeCustomProvider({ ...item, apiKey: "" }, item.id);
    } catch (error) {
      throw new Error(`提供商 ${item.label || item.id} 无效：${error.message}`);
    }
    const current = currentProviders[item.id];
    if (current?.baseUrl === provider.baseUrl && current.apiFormat === provider.apiFormat) {
      provider.apiKey = current.apiKey;
    }
    return [item.id, provider];
  });
  if (new Set(providerEntries.map(([id]) => id)).size !== providerEntries.length) {
    throw new Error("配置文件中的提供商 ID 不能重复。");
  }
  const providerConfigs = Object.fromEntries(providerEntries);
  const appearance = normalizeAppearanceSettings(source);
  if (source.backgroundMode === "image" && !appearance.backgroundImage) {
    throw new Error("配置文件中的背景图片无效或超过大小限制。");
  }
  const activeProvider = Object.hasOwn(providerConfigs, source.activeProvider)
    ? source.activeProvider
    : (providerEntries[0]?.[0] || DEFAULT_PROVIDER_ID);

  return {
    activeProvider,
    providerConfigs,
    theme: ["system", "light", "dark"].includes(source.theme) ? source.theme : "system",
    ...appearance,
    fontSize: normalizeFontSize(source.fontSize ?? DEFAULT_FONT_SIZE),
    showTokenUsage: typeof source.showTokenUsage === "boolean" ? source.showTokenUsage : true,
    showTimestamps: typeof source.showTimestamps === "boolean" ? source.showTimestamps : DEFAULT_SHOW_TIMESTAMPS,
    timestampFormat: normalizeTimestampFormat(source.timestampFormat ?? DEFAULT_TIMESTAMP_FORMAT),
    systemPrompt: typeof source.systemPrompt === "string" ? source.systemPrompt : ""
  };
}
