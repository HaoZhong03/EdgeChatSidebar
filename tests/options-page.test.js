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
    "dockOpacityInput",
    "dockBlurInput",
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
  assert.match(sidebarHtml, /class="bottom-dock"/);
  assert.match(sidebarCss, /background-size:\s*cover/);
  assert.match(sidebarCss, /\.bottom-dock\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*16px;[\s\S]*?left:\s*16px;/);
  assert.match(sidebarCss, /\.messages\s*\{[\s\S]*?padding:[\s\S]*?var\(--composer-height/);
  assert.match(sidebarCss, /scrollbar-gutter:\s*stable/);
  assert.match(sidebarCss, /::-webkit-scrollbar-thumb/);
  assert.match(optionsCss, /::-webkit-scrollbar-thumb/);
  assert.match(sidebarCss, /backdrop-filter:\s*blur\(var\(--bottom-dock-blur\)\)/);
  const statusbarRule = sidebarCss.match(/\.statusbar\s*\{([^}]*)\}/)?.[1] || "";
  assert.doesNotMatch(statusbarRule, /position:\s*fixed/);
  assert.match(sidebarScript, /editButton\.textContent = "编辑"/);
  assert.doesNotMatch(sidebarScript, /editButton\.textContent = "✎"/);
  assert.match(sidebarCss, /\.message-edit\s*\{[\s\S]*?font-size:\s*0\.6875rem;[\s\S]*?font-weight:\s*400;[\s\S]*?line-height:\s*1;/);
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

  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageMetadata.version, manifest.version);
  assert.equal(packageMetadata.author, "HaoZhong03");
  assert.match(optionsHtml, /href="#about"/);
  assert.match(optionsHtml, /id="about"/);
  const escapedVersion = manifest.version.replaceAll(".", "\\.");
  assert.match(optionsHtml, new RegExp(`id="extensionVersion"[^>]*>${escapedVersion}<`));
  assert.match(optionsHtml, />HaoZhong03</);
  assert.match(optionsHtml, /href="mailto:haozhong03@foxmail\.com"/);
  assert.match(optionsScript, /chrome\.runtime\.getManifest\(\)\.version/);
});
