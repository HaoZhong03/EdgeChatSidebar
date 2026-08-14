import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { decryptRecordBytes, encryptRecordBytes } from "../secure-storage.js";

globalThis.crypto ??= webcrypto;

test("AES-GCM records use a non-extractable key and authenticate ID, kind and ciphertext", async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  assert.equal(key.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey("raw", key));

  const record = await encryptRecordBytes(key, {
    id: "session:test",
    kind: "session",
    bytes: new TextEncoder().encode("sensitive message")
  });
  const plaintext = await decryptRecordBytes(key, record, { id: "session:test", kind: "session" });
  assert.equal(new TextDecoder().decode(plaintext), "sensitive message");

  await assert.rejects(
    () => decryptRecordBytes(key, record, { id: "session:other", kind: "session" }),
    /类型或版本不匹配/
  );

  const tampered = { ...record, ciphertext: record.ciphertext.slice(0) };
  new Uint8Array(tampered.ciphertext)[0] ^= 1;
  await assert.rejects(
    () => decryptRecordBytes(key, tampered, { id: "session:test", kind: "session" }),
    /完整性验证失败/
  );
});
