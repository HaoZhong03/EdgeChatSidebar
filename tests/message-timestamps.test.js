import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIMESTAMP_FORMAT,
  formatMessageTimestamp,
  normalizeTimestampFormat
} from "../message-timestamps.js";

const localTimestamp = new Date(2026, 7, 19, 14, 5, 9).getTime();

test("message timestamps support every settings format", () => {
  assert.equal(formatMessageTimestamp(localTimestamp, "time-24"), "14:05");
  assert.equal(formatMessageTimestamp(localTimestamp, "time-12"), "下午 2:05");
  assert.equal(formatMessageTimestamp(localTimestamp, "month-day-time"), "08/19 14:05");
  assert.equal(formatMessageTimestamp(localTimestamp, "full"), "2026/08/19 14:05:09");
});

test("message timestamp formatting rejects missing values and normalizes formats", () => {
  assert.equal(formatMessageTimestamp(undefined, "full"), "");
  assert.equal(formatMessageTimestamp(Number.NaN, "full"), "");
  assert.equal(normalizeTimestampFormat("unknown"), DEFAULT_TIMESTAMP_FORMAT);
  assert.equal(formatMessageTimestamp(localTimestamp, "unknown"), "14:05");
});
