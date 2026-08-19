import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manifest registers the dedicated options page", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.options_ui, {
    page: "options.html",
    open_in_tab: true
  });
  assert.deepEqual(manifest.host_permissions, [
    "https://api.deepseek.com/*",
    "https://api.xiaomimimo.com/*"
  ]);
  assert.deepEqual(manifest.optional_host_permissions, [
    "https://*/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ]);
});

test("settings controls live on the options page and the sidebar opens it", async () => {
  const [optionsHtml, sidebarHtml, sidebarScript] = await Promise.all([
    readFile(new URL("../options.html", import.meta.url), "utf8"),
    readFile(new URL("../sidebar.html", import.meta.url), "utf8"),
    readFile(new URL("../sidebar.js", import.meta.url), "utf8")
  ]);
  const settingControlIds = [
    "themeSelect",
    "showTimestampsInput",
    "timestampFormatSelect",
    "systemPromptInput",
    "webSearchModeSelect",
    "deepseekApiKeyInput",
    "mimoApiKeyInput",
    "customProviderList",
    "cleanupCacheButton",
    "clearAllDataButton",
    "saveSettingsButton",
    "resetSettingsButton"
  ];

  for (const id of settingControlIds) {
    assert.match(optionsHtml, new RegExp(`id=["']${id}["']`));
    assert.doesNotMatch(sidebarHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.match(sidebarHtml, /aria-label="打开拓展选项"/);
  assert.match(sidebarScript, /chrome\.runtime\.openOptionsPage\(\)/);
});
