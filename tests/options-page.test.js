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
  const [optionsHtml, optionsCss, sidebarHtml, sidebarScript, sidebarCss] = await Promise.all([
    readFile(new URL("../options.html", import.meta.url), "utf8"),
    readFile(new URL("../options.css", import.meta.url), "utf8"),
    readFile(new URL("../sidebar.html", import.meta.url), "utf8"),
    readFile(new URL("../sidebar.js", import.meta.url), "utf8"),
    readFile(new URL("../sidebar.css", import.meta.url), "utf8")
  ]);
  const settingControlIds = [
    "themeSelect",
    "backgroundModeSelect",
    "backgroundColorInput",
    "backgroundImageInput",
    "backgroundBrightnessInput",
    "composerOpacityInput",
    "composerBlurInput",
    "statusbarOpacityInput",
    "statusbarBlurInput",
    "fontSizeInput",
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
  assert.doesNotMatch(sidebarScript, /先在拓展选项的模型 API 页面保存当前模型的 API Key，然后开始对话。/);
  assert.match(sidebarHtml, /id="appBackground"/);
  assert.match(sidebarHtml, /class="app-background-overlay"/);
  assert.match(sidebarCss, /background-size:\s*cover/);
  assert.match(sidebarCss, /scroll-padding-bottom:\s*calc\(/);
  assert.match(sidebarCss, /var\(--message-footer-clearance\)/);
  assert.match(sidebarCss, /backdrop-filter:\s*blur\(var\(--composer-panel-blur\)\)/);
  assert.match(sidebarCss, /backdrop-filter:\s*blur\(var\(--statusbar-panel-blur\)\)/);
  assert.match(optionsCss, /font-size:\s*var\(--global-font-size\)/);
  assert.match(sidebarCss, /font-size:\s*var\(--global-font-size\)/);
});

test("the about section shows the current release and maintainer details", async () => {
  const [optionsHtml, optionsScript, manifestText, packageText] = await Promise.all([
    readFile(new URL("../options.html", import.meta.url), "utf8"),
    readFile(new URL("../options.js", import.meta.url), "utf8"),
    readFile(new URL("../manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8")
  ]);
  const manifest = JSON.parse(manifestText);
  const packageMetadata = JSON.parse(packageText);

  assert.equal(manifest.version, "2.0.0");
  assert.equal(packageMetadata.version, manifest.version);
  assert.equal(packageMetadata.author, "HaoZhong03");
  assert.match(optionsHtml, /href="#about"/);
  assert.match(optionsHtml, /id="about"/);
  assert.match(optionsHtml, /id="extensionVersion"[^>]*>2\.0\.0</);
  assert.match(optionsHtml, />HaoZhong03</);
  assert.match(optionsHtml, /href="mailto:haozhong03@foxmail\.com"/);
  assert.match(optionsScript, /chrome\.runtime\.getManifest\(\)\.version/);
});
