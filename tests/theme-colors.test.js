import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function getThemeBlock(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing theme block ${selector}`);
  return match[1];
}

function getVariable(block, name) {
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `missing --${name}`);
  return match[1];
}

function isGrayscale(hex) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return red === green && green === blue;
}

test("base option and sidebar themes use grayscale foundations with colored primary actions", async () => {
  const [optionsCss, sidebarCss] = await Promise.all([
    readFile(new URL("../options.css", import.meta.url), "utf8"),
    readFile(new URL("../sidebar.css", import.meta.url), "utf8")
  ]);
  const cases = [
    {
      css: optionsCss,
      variables: ["bg", "surface", "surface-soft", "surface-accent", "border", "border-strong", "text", "text-strong", "text-muted", "field-bg"]
    },
    {
      css: sidebarCss,
      variables: ["bg", "surface", "surface-soft", "surface-muted", "border", "border-strong", "text", "text-strong", "text-muted", "text-subtle", "field-bg", "code-bg", "pre-bg", "pre-text"]
    }
  ];

  for (const { css, variables } of cases) {
    for (const selector of [":root", ':root[data-theme="dark"]']) {
      const block = getThemeBlock(css, selector);
      for (const variable of variables) {
        const color = getVariable(block, variable);
        assert.equal(isGrayscale(color), true, `${selector} --${variable} should be grayscale, received ${color}`);
      }
      assert.equal(isGrayscale(getVariable(block, "primary")), false, `${selector} primary action should retain an accent color`);
    }
  }
});

test("ordinary hover surfaces no longer use the primary blue tint", async () => {
  const [optionsCss, sidebarCss] = await Promise.all([
    readFile(new URL("../options.css", import.meta.url), "utf8"),
    readFile(new URL("../sidebar.css", import.meta.url), "utf8")
  ]);
  assert.match(optionsCss, /\.section-nav a:focus-visible\s*\{[\s\S]*?background:\s*var\(--surface-soft\)/);
  assert.match(optionsCss, /\.ghost:hover\s*\{[\s\S]*?background:\s*var\(--surface-soft\)/);
  assert.match(sidebarCss, /\.icon-button:hover\s*\{[\s\S]*?background:\s*var\(--surface-muted\)/);
  assert.match(sidebarCss, /\.model-switch:hover\s*\{[\s\S]*?background:\s*var\(--surface-muted\)/);
  assert.match(sidebarCss, /\.model-menu-option:hover\s*\{[\s\S]*?background:\s*var\(--surface-muted\)/);
});
