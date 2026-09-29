import test from "node:test";
import assert from "node:assert/strict";
import { createConfigArchive, parseConfigArchive } from "../config-transfer.js";
import { normalizeCustomProvider } from "../providers.js";

function provider(id, baseUrl, apiKey) {
  return normalizeCustomProvider({
    label: "示例服务",
    baseUrl,
    apiFormat: "openai",
    apiKey,
    models: ["model-a", "model-b"],
    model: "model-b",
    optionalFields: [{ key: "temperature", value: "0.7" }],
    imageInput: true
  }, id);
}

test("configuration archive contains settings but no API key or conversation", () => {
  const archive = createConfigArchive({
    providerConfigs: { demo: provider("demo", "https://example.com/v1", "secret-api-key") },
    activeProvider: "demo",
    theme: "dark",
    backgroundMode: "solid",
    backgroundColor: "#123456",
    backgroundImage: "data:image/png;base64,AA==",
    dockOpacity: 78,
    componentBlur: 18,
    fontSize: 18,
    showTokenUsage: false,
    showTimestamps: true,
    timestampFormat: "full",
    systemPrompt: "请简洁回答。",
    sessions: [{ messages: [{ content: "private conversation" }] }]
  });
  const serialized = JSON.stringify(archive);
  assert.equal(archive.settings.providers[0].model, "model-b");
  assert.equal(archive.settings.systemPrompt, "请简洁回答。");
  assert.equal(archive.settings.dockOpacity, 78);
  assert.equal(archive.settings.componentBlur, 18);
  assert.equal(archive.settings.backgroundColor, "#123456");
  assert.equal(archive.settings.backgroundImage, "data:image/png;base64,AA==");
  assert.doesNotMatch(serialized, /secret-api-key|private conversation|"apiKey"|"sessions"/);
});

test("import preserves only matching local API keys and ignores keys in the file", () => {
  const existing = {
    same: provider("same", "https://example.com/v1", "local-key"),
    changed: provider("changed", "https://old.example.com/v1", "old-key")
  };
  const archive = createConfigArchive({
    providerConfigs: {
      same: provider("same", "https://example.com/v1", "export-key"),
      changed: provider("changed", "https://new.example.com/v1", "export-key")
    },
    activeProvider: "same",
    theme: "light",
    systemPrompt: "test prompt"
  });
  archive.settings.providers[0].apiKey = "malicious-file-key";
  const imported = parseConfigArchive(JSON.stringify(archive), existing);
  assert.equal(imported.providerConfigs.same.apiKey, "local-key");
  assert.equal(imported.providerConfigs.changed.apiKey, "");
  assert.equal(imported.providerConfigs.same.model, "model-b");
  assert.deepEqual(imported.providerConfigs.same.optionalFields, [{ key: "temperature", value: "0.7" }]);
  assert.equal(imported.theme, "light");
  assert.equal(imported.systemPrompt, "test prompt");
});

test("import rejects unsupported or malformed configuration", () => {
  assert.throws(() => parseConfigArchive("not json"), /JSON/);
  assert.throws(() => parseConfigArchive(JSON.stringify({ format: "other", version: 1 })), /格式或版本/);
  const archive = createConfigArchive({ providerConfigs: {} });
  delete archive.settings.theme;
  assert.throws(() => parseConfigArchive(JSON.stringify(archive)), /必要设置/);
  archive.settings.theme = "system";
  archive.settings.providers = [{ id: "bad", label: "x", baseUrl: "http://public.example", models: ["x"] }];
  assert.throws(() => parseConfigArchive(JSON.stringify(archive)), /提供商.*无效/);
  archive.settings.providers[0].id = "__proto__";
  assert.throws(() => parseConfigArchive(JSON.stringify(archive)), /提供商 ID/);
});
