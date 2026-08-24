import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  getBackgroundImageTone,
  isValidHexColor,
  normalizeAppearanceSettings,
  normalizeBackgroundImage,
  normalizeHexColor
} from "../appearance.js";

test("appearance settings normalize colors and bounded visual effects", () => {
  assert.equal(isValidHexColor("A1b2C3"), true);
  assert.equal(isValidHexColor("#A1b2C3"), true);
  assert.equal(isValidHexColor("#12345"), false);
  assert.equal(normalizeHexColor("a1b2c3"), "#A1B2C3");

  assert.deepEqual(normalizeAppearanceSettings({
    backgroundMode: "solid",
    backgroundColor: "102030",
    backgroundBrightness: 999,
    composerOpacity: -10,
    composerBlur: 13.6,
    statusbarOpacity: "65",
    statusbarBlur: 99
  }), {
    ...DEFAULT_APPEARANCE_SETTINGS,
    backgroundMode: "solid",
    backgroundColor: "#102030",
    backgroundBrightness: 150,
    composerOpacity: 0,
    composerBlur: 14,
    statusbarOpacity: 65,
    statusbarBlur: 30
  });
});

test("background tone uses a white overlay instead of over-brightening the image", () => {
  assert.deepEqual(getBackgroundImageTone(80), {
    imageBrightness: 80,
    whiteOverlayOpacity: 0
  });
  assert.deepEqual(getBackgroundImageTone(125), {
    imageBrightness: 100,
    whiteOverlayOpacity: 0.25
  });
  assert.deepEqual(getBackgroundImageTone(150), {
    imageBrightness: 100,
    whiteOverlayOpacity: 0.5
  });
});

test("background images only accept supported local image data URLs", () => {
  const png = "data:image/png;base64,aGVsbG8=";
  assert.equal(normalizeBackgroundImage(png), png);
  assert.equal(normalizeBackgroundImage("https://example.com/background.png"), "");
  assert.equal(normalizeBackgroundImage("data:image/svg+xml;base64,PHN2Zz4="), "");
  assert.equal(normalizeBackgroundImage("data:text/plain;base64,aGVsbG8="), "");
});
