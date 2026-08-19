import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import "fake-indexeddb/auto";
import {
  LEGACY_STORAGE_KEYS,
  PREFERENCE_KEYS,
  clearAllLocalData,
  garbageCollectSecureStore,
  markSecureCurrentSessionUsageStale,
  readLegacyStorage,
  readSecureConfig,
  readSecureState,
  removeLegacyStorage,
  writeSecureConfig,
  writeSecureState
} from "../secure-storage.js";

globalThis.crypto ??= webcrypto;

test("shared web-search preference replaces and migrates the MiMo-only key", () => {
  assert.equal(PREFERENCE_KEYS.webSearchMode, "edgeChat.webSearchMode");
  assert.equal(LEGACY_STORAGE_KEYS.includes("edgeChat.mimoWebSearchMode"), true);
});

test("timestamp display preferences are stored as non-sensitive settings", () => {
  assert.equal(PREFERENCE_KEYS.showTimestamps, "edgeChat.showTimestamps");
  assert.equal(PREFERENCE_KEYS.timestampFormat, "edgeChat.timestampFormat");
});

function openRawDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("edge-chat-sidebar", 1);
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function getAll(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

test("secure state round-trips while raw IndexedDB contains no sensitive plaintext", async () => {
  const secret = "sk-plain-secret-must-not-appear";
  const message = "private conversation text";
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  await writeSecureState({
    config: {
      providerConfigs: {
        deepseek: { id: "deepseek", type: "builtin", apiKey: secret, model: "deepseek-v4-flash" }
      },
      systemPrompt: "private system prompt"
    },
    sessions: [{
      id: "s1",
      title: "private title",
      createdAt: 1,
      updatedAt: 2,
      messages: [{
        role: "user",
        content: message,
        timestamp: 1787119509000,
        images: [{ id: "i1", name: "secret.png", mimeType: "image/png", size: 8, dataUrl }]
      }]
    }],
    currentSessionId: "s1"
  });

  const database = await openRawDatabase();
  const recordTransaction = database.transaction("records", "readonly");
  const records = await getAll(recordTransaction.objectStore("records"));
  const keyTransaction = database.transaction("keys", "readonly");
  const keys = await getAll(keyTransaction.objectStore("keys"));
  database.close();

  const raw = JSON.stringify(records);
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes(message), false);
  assert.equal(raw.includes(dataUrl), false);
  assert.equal(raw.includes("private system prompt"), false);
  assert.equal(keys[0].key.extractable, false);

  const restored = await readSecureState();
  assert.equal(restored.config.providerConfigs.deepseek.apiKey, secret);
  assert.equal(restored.sessions[0].messages[0].content, message);
  assert.equal(restored.sessions[0].messages[0].timestamp, 1787119509000);
  assert.equal(restored.sessions[0].messages[0].images[0].dataUrl, dataUrl);
  await clearAllLocalData();
});

test("garbage collection removes orphan sessions and images but preserves shared references", async () => {
  const shared = { id: "shared", name: "shared.png", mimeType: "image/png", size: 3, dataUrl: "data:image/png;base64,AQID" };
  const orphan = { id: "orphan", name: "orphan.png", mimeType: "image/png", size: 3, dataUrl: "data:image/png;base64,BAUG" };
  const session1 = {
    id: "s1",
    title: "one",
    messages: [{ role: "user", content: "one", images: [shared] }],
    createdAt: 1,
    updatedAt: 1
  };
  const session2 = {
    id: "s2",
    title: "two",
    messages: [{ role: "user", content: "two", images: [shared, orphan] }],
    createdAt: 2,
    updatedAt: 2
  };

  await writeSecureState({ config: {}, sessions: [session1, session2], currentSessionId: "s1" });
  await writeSecureState({ config: {}, sessions: [session1], currentSessionId: "s1" });
  const result = await garbageCollectSecureStore();
  assert.equal(result.sessions, 1);
  assert.equal(result.images, 1);
  assert.ok(result.releasedBytes > 0);

  const restored = await readSecureState();
  assert.equal(restored.sessions.length, 1);
  assert.equal(restored.sessions[0].messages[0].images[0].id, "shared");
  await clearAllLocalData();
});

test("options updates encrypted config without replacing sessions", async () => {
  await writeSecureState({
    config: { providerConfigs: {}, systemPrompt: "old prompt" },
    sessions: [{
      id: "options-session",
      title: "keep me",
      messages: [{ role: "user", content: "preserved", images: [] }],
      contextUsage: { promptTokens: 12, totalTokens: 12 },
      contextUsageState: "measured",
      createdAt: 1,
      updatedAt: 2
    }],
    currentSessionId: "options-session"
  });

  await writeSecureConfig({ providerConfigs: {}, systemPrompt: "new prompt" });
  await markSecureCurrentSessionUsageStale();

  const config = await readSecureConfig();
  const restored = await readSecureState();
  assert.equal(config.systemPrompt, "new prompt");
  assert.equal(restored.sessions[0].messages[0].content, "preserved");
  assert.equal(restored.sessions[0].contextUsageState, "stale");
  await clearAllLocalData();
});

test("legacy plaintext survives an interrupted migration and is removed only after encrypted verification", async () => {
  const legacyValues = {
    deepseekApiKey: "legacy-secret",
    deepseekSystemPrompt: "legacy prompt",
    deepseekSessions: [{
      id: "legacy-session",
      title: "legacy",
      messages: [{ role: "user", content: "legacy message", images: [] }],
      createdAt: 1,
      updatedAt: 1
    }]
  };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(keys.filter((key) => key in legacyValues).map((key) => [key, legacyValues[key]]));
        },
        async remove(keys) {
          for (const key of keys) delete legacyValues[key];
        },
        async setAccessLevel() {}
      }
    }
  };

  const legacy = await readLegacyStorage();
  await writeSecureState({
    config: {
      providerConfigs: { deepseek: { id: "deepseek", type: "builtin", apiKey: legacy.deepseekApiKey, model: "deepseek-v4-flash" } },
      systemPrompt: legacy.deepseekSystemPrompt
    },
    sessions: legacy.deepseekSessions,
    currentSessionId: "legacy-session"
  });

  assert.equal(legacyValues.deepseekApiKey, "legacy-secret", "interrupted migration must retain plaintext source");
  const verified = await readSecureState();
  assert.equal(verified.config.providerConfigs.deepseek.apiKey, "legacy-secret");
  assert.equal(verified.sessions[0].messages[0].content, "legacy message");
  await removeLegacyStorage();
  assert.equal("deepseekApiKey" in legacyValues, false);
  assert.equal("deepseekSessions" in legacyValues, false);
  await clearAllLocalData();
  delete globalThis.chrome;
});
