const DATABASE_NAME = "edge-chat-sidebar";
const DATABASE_VERSION = 1;
const SCHEMA_VERSION = 1;
const KEY_ID = "vault-key-v1";
const KEY_STORE = "keys";
const RECORD_STORE = "records";
const BACKGROUND_IMAGE_RECORD_ID = "background-image";

export const PREFERENCE_KEYS = Object.freeze({
  theme: "edgeChat.theme",
  activeProvider: "edgeChat.activeProvider",
  activeModel: "edgeChat.activeModel",
  webSearchMode: "edgeChat.webSearchMode",
  fontSize: "edgeChat.fontSize",
  backgroundMode: "edgeChat.backgroundMode",
  backgroundColor: "edgeChat.backgroundColor",
  backgroundBrightness: "edgeChat.backgroundBrightness",
  dockOpacity: "edgeChat.dockOpacity",
  dockBlur: "edgeChat.dockBlur",
  // Retained so v2.0 settings can be migrated into the unified bottom card.
  composerOpacity: "edgeChat.composerOpacity",
  composerBlur: "edgeChat.composerBlur",
  statusbarOpacity: "edgeChat.statusbarOpacity",
  statusbarBlur: "edgeChat.statusbarBlur",
  showTimestamps: "edgeChat.showTimestamps",
  timestampFormat: "edgeChat.timestampFormat",
  schemaVersion: "edgeChat.schemaVersion"
});

export const LEGACY_STORAGE_KEYS = Object.freeze([
  "activeModelProvider",
  "modelProviderConfigs",
  "mimoWebSearchMode",
  "edgeChat.mimoWebSearchMode",
  "edgeChat.messageFontSize",
  "deepseekTheme",
  "deepseekSystemPrompt",
  "deepseekMessages",
  "deepseekSessions",
  "deepseekCurrentSessionId",
  "deepseekApiKey",
  "deepseekModel",
  "deepseekUsage",
  "deepseekImages",
  "mimoApiKey",
  "mimoModel",
  "mimoMessages",
  "mimoSessions",
  "edgeChat.config",
  "edgeChat.sessions",
  "edgeChat.messages"
]);

let databasePromise;
let storageQueue = Promise.resolve();

export class SecureStorageError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "SecureStorageError";
    this.code = code;
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("IndexedDB transaction aborted.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error || new Error("IndexedDB transaction failed.")), { once: true });
  });
}

function openDatabase() {
  if (!globalThis.indexedDB) {
    throw new SecureStorageError("unavailable", "当前环境不支持安全的 IndexedDB 存储。");
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.createObjectStore(KEY_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(RECORD_STORE)) {
        database.createObjectStore(RECORD_STORE, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => {
      const database = request.result;
      database.addEventListener("versionchange", () => database.close());
      resolve(database);
    }, { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("blocked", () => reject(new SecureStorageError("blocked", "安全存储数据库正在被其他页面占用。")), { once: true });
  });

  return databasePromise;
}

function encodeAad(kind, id, schemaVersion = SCHEMA_VERSION) {
  return new TextEncoder().encode(`${schemaVersion}:${kind}:${id}`);
}

function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Expected binary data.");
}

export async function encryptRecordBytes(key, { id, kind, bytes, schemaVersion = SCHEMA_VERSION }) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = asUint8Array(bytes);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encodeAad(kind, id, schemaVersion), tagLength: 128 },
    key,
    plaintext
  );
  return {
    id,
    kind,
    schemaVersion,
    iv: iv.buffer,
    ciphertext,
    updatedAt: Date.now(),
    approxBytes: ciphertext.byteLength + iv.byteLength
  };
}

export async function decryptRecordBytes(key, record, expected = {}) {
  if (!record || typeof record !== "object") {
    throw new SecureStorageError("missing-record", "加密记录不存在。");
  }
  const id = expected.id || record.id;
  const kind = expected.kind || record.kind;
  if (record.id !== id || record.kind !== kind || record.schemaVersion !== SCHEMA_VERSION) {
    throw new SecureStorageError("authentication-failed", "加密记录类型或版本不匹配。");
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asUint8Array(record.iv),
        additionalData: encodeAad(kind, id, record.schemaVersion),
        tagLength: 128
      },
      key,
      record.ciphertext
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    throw new SecureStorageError("authentication-failed", `记录 ${id} 的完整性验证失败。`, error);
  }
}

async function encryptJson(key, id, kind, value) {
  return encryptRecordBytes(key, {
    id,
    kind,
    bytes: new TextEncoder().encode(JSON.stringify(value))
  });
}

async function decryptJson(key, record, kind) {
  const bytes = await decryptRecordBytes(key, record, { id: record.id, kind });
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new SecureStorageError("invalid-record", `记录 ${record.id} 的内容无法解析。`, error);
  }
}

async function getRecord(database, id) {
  const transaction = database.transaction(RECORD_STORE, "readonly");
  const value = await requestToPromise(transaction.objectStore(RECORD_STORE).get(id));
  await transactionDone(transaction);
  return value;
}

async function getAllRecords(database) {
  const transaction = database.transaction(RECORD_STORE, "readonly");
  const value = await requestToPromise(transaction.objectStore(RECORD_STORE).getAll());
  await transactionDone(transaction);
  return value;
}

async function getOrCreateKey(database) {
  const readTransaction = database.transaction(KEY_STORE, "readonly");
  const existing = await requestToPromise(readTransaction.objectStore(KEY_STORE).get(KEY_ID));
  await transactionDone(readTransaction);
  if (existing?.key) return existing.key;

  const records = await getAllRecords(database);
  if (records.length > 0) {
    throw new SecureStorageError("missing-key", "检测到加密数据，但本机加密密钥已丢失。请清空全部数据并重新初始化。");
  }

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const writeTransaction = database.transaction(KEY_STORE, "readwrite");
  writeTransaction.objectStore(KEY_STORE).put({ id: KEY_ID, key, createdAt: Date.now() });
  await transactionDone(writeTransaction);
  return key;
}

export async function initializeSecureStore() {
  if (globalThis.chrome?.storage?.local?.setAccessLevel) {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  }
  const database = await openDatabase();
  const key = await getOrCreateKey(database);
  return { database, key };
}

function dataUrlToBytes(dataUrl) {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl || "");
  if (!match) throw new SecureStorageError("invalid-image", "图片不是有效的 Data URL。");
  const isBase64 = /^data:[^,]*;base64,/i.test(dataUrl);
  const binary = isBase64 ? atob(match[2]) : decodeURIComponent(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mimeType: match[1] || "application/octet-stream", bytes };
}

function bytesToDataUrl(bytes, mimeType) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function packImage(image) {
  const { mimeType, bytes } = dataUrlToBytes(image.dataUrl);
  const metadata = new TextEncoder().encode(JSON.stringify({
    name: image.name || "image",
    mimeType: image.mimeType || mimeType,
    size: Number.isFinite(image.size) ? image.size : bytes.byteLength
  }));
  const packed = new Uint8Array(4 + metadata.byteLength + bytes.byteLength);
  new DataView(packed.buffer).setUint32(0, metadata.byteLength, false);
  packed.set(metadata, 4);
  packed.set(bytes, 4 + metadata.byteLength);
  return packed;
}

function unpackImage(bytes, id) {
  if (bytes.byteLength < 4) throw new SecureStorageError("invalid-image", `图片 ${id} 的加密内容无效。`);
  const metadataLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  if (metadataLength > bytes.byteLength - 4) throw new SecureStorageError("invalid-image", `图片 ${id} 的元数据无效。`);
  const metadata = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metadataLength)));
  const imageBytes = bytes.subarray(4 + metadataLength);
  return {
    id,
    name: metadata.name,
    mimeType: metadata.mimeType,
    size: metadata.size,
    dataUrl: bytesToDataUrl(imageBytes, metadata.mimeType)
  };
}

function imageRecordId(imageId) {
  return `image:${imageId}`;
}

function sessionRecordId(sessionId) {
  return `session:${sessionId}`;
}

function stripImagesFromSession(session, imagePayloads) {
  return {
    ...session,
    messages: (session.messages || []).map((message) => ({
      ...message,
      images: (message.images || []).map((image) => {
        const imageId = image.id || crypto.randomUUID();
        if (image.dataUrl) imagePayloads.set(imageId, { ...image, id: imageId });
        return {
          id: imageId,
          imageId,
          name: image.name || "image",
          mimeType: image.mimeType || "image/png",
          size: Number.isFinite(image.size) ? image.size : 0
        };
      })
    }))
  };
}

function enqueue(operation) {
  const next = storageQueue.then(operation, operation);
  storageQueue = next.catch(() => {});
  return next;
}

export function writeSecureState(state) {
  return enqueue(async () => {
    const { database, key } = await initializeSecureStore();
    const imagePayloads = new Map();
    const sessions = (state.sessions || []).map((session) => stripImagesFromSession(session, imagePayloads));
    const index = {
      sessionIds: sessions.map((session) => session.id),
      currentSessionId: state.currentSessionId || sessions[0]?.id || "",
      updatedAt: Date.now()
    };
    const encrypted = await Promise.all([
      encryptJson(key, "config", "config", state.config || {}),
      encryptJson(key, "session-index", "session-index", index),
      ...sessions.map((session) => encryptJson(key, sessionRecordId(session.id), "session", session)),
      ...[...imagePayloads].map(([id, image]) => encryptRecordBytes(key, {
        id: imageRecordId(id),
        kind: "image",
        bytes: packImage(image)
      }))
    ]);

    const transaction = database.transaction(RECORD_STORE, "readwrite");
    const store = transaction.objectStore(RECORD_STORE);
    for (const record of encrypted) store.put(record);
    await transactionDone(transaction);
    return { sessions: sessions.length, images: imagePayloads.size };
  });
}

export async function hasSecureState() {
  const database = await openDatabase();
  return Boolean(await getRecord(database, "session-index"));
}

export async function readSecureState() {
  const { database, key } = await initializeSecureStore();
  const configRecord = await getRecord(database, "config");
  const indexRecord = await getRecord(database, "session-index");
  if (!configRecord && !indexRecord) return null;
  if (!configRecord || !indexRecord) {
    throw new SecureStorageError("incomplete-state", "安全存储状态不完整，已停止读取以避免静默丢失数据。");
  }

  const [config, index] = await Promise.all([
    decryptJson(key, configRecord, "config"),
    decryptJson(key, indexRecord, "session-index")
  ]);
  const sessionRecords = await Promise.all((index.sessionIds || []).map((id) => getRecord(database, sessionRecordId(id))));
  if (sessionRecords.some((record) => !record)) {
    throw new SecureStorageError("incomplete-state", "会话索引引用了缺失记录，已停止读取。");
  }
  const sessions = await Promise.all(sessionRecords.map((record) => decryptJson(key, record, "session")));
  const imageIds = new Set();
  for (const session of sessions) {
    for (const message of session.messages || []) {
      for (const image of message.images || []) imageIds.add(image.imageId || image.id);
    }
  }
  const images = new Map();
  await Promise.all([...imageIds].map(async (id) => {
    const record = await getRecord(database, imageRecordId(id));
    if (!record) throw new SecureStorageError("incomplete-state", `会话引用的图片 ${id} 已丢失。`);
    const bytes = await decryptRecordBytes(key, record, { id: imageRecordId(id), kind: "image" });
    images.set(id, unpackImage(bytes, id));
  }));

  for (const session of sessions) {
    session.messages = (session.messages || []).map((message) => ({
      ...message,
      images: (message.images || []).map((reference) => ({ ...images.get(reference.imageId || reference.id) }))
    }));
  }
  return { config, sessions, currentSessionId: index.currentSessionId };
}

export async function readSecureConfig() {
  const { database, key } = await initializeSecureStore();
  const configRecord = await getRecord(database, "config");
  if (!configRecord) return null;
  return decryptJson(key, configRecord, "config");
}

export function writeSecureConfig(config) {
  return enqueue(async () => {
    const { database, key } = await initializeSecureStore();
    const encrypted = await encryptJson(key, "config", "config", config || {});
    const transaction = database.transaction(RECORD_STORE, "readwrite");
    transaction.objectStore(RECORD_STORE).put(encrypted);
    await transactionDone(transaction);
  });
}

export async function readSecureBackgroundImage() {
  const { database, key } = await initializeSecureStore();
  const record = await getRecord(database, BACKGROUND_IMAGE_RECORD_ID);
  if (!record) return "";
  const bytes = await decryptRecordBytes(key, record, {
    id: BACKGROUND_IMAGE_RECORD_ID,
    kind: "background-image"
  });
  return unpackImage(bytes, BACKGROUND_IMAGE_RECORD_ID).dataUrl;
}

export function writeSecureBackgroundImage(dataUrl) {
  return enqueue(async () => {
    const { database, key } = await initializeSecureStore();
    let encrypted;
    if (dataUrl) {
      const { mimeType, bytes } = dataUrlToBytes(dataUrl);
      encrypted = await encryptRecordBytes(key, {
        id: BACKGROUND_IMAGE_RECORD_ID,
        kind: "background-image",
        bytes: packImage({
          dataUrl,
          name: "background",
          mimeType,
          size: bytes.byteLength
        })
      });
    }

    const transaction = database.transaction(RECORD_STORE, "readwrite");
    const store = transaction.objectStore(RECORD_STORE);
    if (!dataUrl) {
      store.delete(BACKGROUND_IMAGE_RECORD_ID);
    } else {
      store.put(encrypted);
    }
    await transactionDone(transaction);
  });
}

export function markSecureCurrentSessionUsageStale() {
  return enqueue(async () => {
    const { database, key } = await initializeSecureStore();
    const indexRecord = await getRecord(database, "session-index");
    if (!indexRecord) return false;
    const index = await decryptJson(key, indexRecord, "session-index");
    const sessionId = index.currentSessionId;
    if (!sessionId) return false;
    const recordId = sessionRecordId(sessionId);
    const sessionRecord = await getRecord(database, recordId);
    if (!sessionRecord) return false;
    const session = await decryptJson(key, sessionRecord, "session");
    session.contextUsageState = (session.messages || []).length > 0 ? "stale" : "empty";
    const encrypted = await encryptJson(key, recordId, "session", session);
    const transaction = database.transaction(RECORD_STORE, "readwrite");
    transaction.objectStore(RECORD_STORE).put(encrypted);
    await transactionDone(transaction);
    return true;
  });
}

export function garbageCollectSecureStore() {
  return enqueue(async () => {
    const { database, key } = await initializeSecureStore();
    const records = await getAllRecords(database);
    const byId = new Map(records.map((record) => [record.id, record]));
    const indexRecord = byId.get("session-index");
    if (!indexRecord) return { sessions: 0, images: 0, temporary: 0, releasedBytes: 0 };
    const index = await decryptJson(key, indexRecord, "session-index");
    const liveSessions = new Set((index.sessionIds || []).map(sessionRecordId));
    const liveImages = new Set();
    for (const recordId of liveSessions) {
      const record = byId.get(recordId);
      if (!record) throw new SecureStorageError("incomplete-state", `会话记录 ${recordId} 已丢失。`);
      const session = await decryptJson(key, record, "session");
      for (const message of session.messages || []) {
        for (const image of message.images || []) liveImages.add(imageRecordId(image.imageId || image.id));
      }
    }

    const removals = records.filter((record) => (
      (record.kind === "session" && !liveSessions.has(record.id))
      || (record.kind === "image" && !liveImages.has(record.id))
      || record.kind === "temporary"
      || record.id.startsWith("migration:")
    ));
    if (removals.length > 0) {
      const transaction = database.transaction(RECORD_STORE, "readwrite");
      const store = transaction.objectStore(RECORD_STORE);
      for (const record of removals) store.delete(record.id);
      await transactionDone(transaction);
    }

    return {
      sessions: removals.filter((record) => record.kind === "session").length,
      images: removals.filter((record) => record.kind === "image").length,
      temporary: removals.filter((record) => record.kind === "temporary" || record.id.startsWith("migration:")).length,
      releasedBytes: removals.reduce((total, record) => total + (Number(record.approxBytes) || 0), 0)
    };
  });
}

export async function readLegacyStorage() {
  const result = {};
  if (globalThis.chrome?.storage?.local) {
    Object.assign(result, await chrome.storage.local.get(LEGACY_STORAGE_KEYS));
  }
  if (globalThis.localStorage) {
    for (const key of LEGACY_STORAGE_KEYS) {
      if (key in result) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      try {
        result[key] = JSON.parse(raw);
      } catch {
        result[key] = raw;
      }
    }
  }
  return result;
}

export async function removeLegacyStorage() {
  if (globalThis.chrome?.storage?.local) await chrome.storage.local.remove(LEGACY_STORAGE_KEYS);
  if (globalThis.localStorage) {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
  }
}

export async function clearAllLocalData() {
  await storageQueue.catch(() => {});
  if (databasePromise) {
    try {
      const database = await databasePromise;
      database.close();
    } catch {
      // Continue with deletion even if opening the database failed.
    }
    databasePromise = undefined;
  }

  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener("success", resolve, { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("blocked", () => reject(new SecureStorageError("blocked", "请关闭其他 Edge Chat Sidebar 页面后重试。")), { once: true });
  });

  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.remove([...LEGACY_STORAGE_KEYS, ...Object.values(PREFERENCE_KEYS)]);
  }
  if (globalThis.localStorage) {
    for (const key of [...LEGACY_STORAGE_KEYS, ...Object.values(PREFERENCE_KEYS)]) localStorage.removeItem(key);
  }
  await removeDynamicHostPermissions();
}

export async function removeDynamicHostPermissions() {
  if (!globalThis.chrome?.permissions?.getAll) return 0;
  const requiredOrigins = new Set([
    "https://api.deepseek.com/*",
    "https://api.xiaomimimo.com/*"
  ]);
  const granted = await chrome.permissions.getAll();
  const dynamicOrigins = (granted.origins || []).filter((origin) => !requiredOrigins.has(origin));
  if (dynamicOrigins.length > 0) {
    await chrome.permissions.remove({ origins: dynamicOrigins });
  }
  return dynamicOrigins.length;
}

export function formatReleasedBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
