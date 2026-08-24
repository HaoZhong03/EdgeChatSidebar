import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  normalizeFontSize
} from "../font-size.js";

test("global font size normalizes stored and user-entered values", () => {
  assert.equal(normalizeFontSize(undefined), DEFAULT_FONT_SIZE);
  assert.equal(normalizeFontSize(""), DEFAULT_FONT_SIZE);
  assert.equal(normalizeFontSize("17"), 17);
  assert.equal(normalizeFontSize(15.6), 16);
  assert.equal(normalizeFontSize(1), MIN_FONT_SIZE);
  assert.equal(normalizeFontSize(100), MAX_FONT_SIZE);
});
