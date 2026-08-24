export const BACKGROUND_MODES = Object.freeze(["default", "solid", "image"]);

export const PRESET_BACKGROUND_COLORS = Object.freeze([
  "#F4F7FB",
  "#EAF2FF",
  "#F3F0FF",
  "#EAF8F1",
  "#FFF3E8",
  "#1A1D24"
]);

export const SUPPORTED_BACKGROUND_IMAGE_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif"
]);

export const MAX_BACKGROUND_IMAGE_BYTES = 10 * 1024 * 1024;

export const DEFAULT_APPEARANCE_SETTINGS = Object.freeze({
  backgroundMode: "default",
  backgroundColor: PRESET_BACKGROUND_COLORS[0],
  backgroundImage: "",
  backgroundBrightness: 100,
  composerOpacity: 100,
  composerBlur: 0,
  statusbarOpacity: 100,
  statusbarBlur: 0
});

export function normalizeBackgroundMode(value) {
  return BACKGROUND_MODES.includes(value) ? value : DEFAULT_APPEARANCE_SETTINGS.backgroundMode;
}

export function normalizeHexColor(value, fallback = DEFAULT_APPEARANCE_SETTINGS.backgroundColor) {
  if (typeof value !== "string") return fallback;
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : fallback;
}

export function isValidHexColor(value) {
  return typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim());
}

function normalizeNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

export function normalizeBackgroundImage(value) {
  if (typeof value !== "string") return "";
  const match = value.match(/^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([a-z0-9+/=]+)$/i);
  if (!match || !SUPPORTED_BACKGROUND_IMAGE_TYPES.includes(match[1].toLowerCase())) return "";

  const padding = (match[2].match(/=*$/) || [""])[0].length;
  const approximateBytes = Math.floor((match[2].length * 3) / 4) - padding;
  return approximateBytes <= MAX_BACKGROUND_IMAGE_BYTES ? value : "";
}

export function getBackgroundImageTone(value) {
  const brightness = normalizeNumber(
    value,
    20,
    150,
    DEFAULT_APPEARANCE_SETTINGS.backgroundBrightness
  );
  return {
    imageBrightness: Math.min(brightness, 100),
    whiteOverlayOpacity: Math.max(0, (brightness - 100) / 100)
  };
}

export function normalizeAppearanceSettings(value = {}) {
  return {
    backgroundMode: normalizeBackgroundMode(value.backgroundMode),
    backgroundColor: normalizeHexColor(value.backgroundColor),
    backgroundImage: normalizeBackgroundImage(value.backgroundImage),
    backgroundBrightness: normalizeNumber(
      value.backgroundBrightness,
      20,
      150,
      DEFAULT_APPEARANCE_SETTINGS.backgroundBrightness
    ),
    composerOpacity: normalizeNumber(
      value.composerOpacity,
      0,
      100,
      DEFAULT_APPEARANCE_SETTINGS.composerOpacity
    ),
    composerBlur: normalizeNumber(
      value.composerBlur,
      0,
      30,
      DEFAULT_APPEARANCE_SETTINGS.composerBlur
    ),
    statusbarOpacity: normalizeNumber(
      value.statusbarOpacity,
      0,
      100,
      DEFAULT_APPEARANCE_SETTINGS.statusbarOpacity
    ),
    statusbarBlur: normalizeNumber(
      value.statusbarBlur,
      0,
      30,
      DEFAULT_APPEARANCE_SETTINGS.statusbarBlur
    )
  };
}
