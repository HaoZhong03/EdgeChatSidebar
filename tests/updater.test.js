import test from "node:test";
import assert from "node:assert/strict";
import {
  applyUpdateFiles,
  compareVersions,
  isSafeUpdatePath,
  parseTarArchive,
  validateUpdateFiles
} from "../updater.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeText(target, offset, length, value) {
  target.set(encoder.encode(value).subarray(0, length), offset);
}

function writeOctal(target, offset, length, value) {
  writeText(target, offset, length, value.toString(8).padStart(length - 1, "0"));
}

function createTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const header = new Uint8Array(512);
    writeText(header, 0, 100, entry.path);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, data.byteLength);
    writeOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = "0".charCodeAt(0);
    writeText(header, 257, 6, "ustar");
    writeText(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    chunks.push(header, data, new Uint8Array((512 - (data.byteLength % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const tar = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    tar.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return tar;
}

function createMemoryDirectory(initialFiles, failOncePath = "") {
  const files = new Map(Object.entries(initialFiles).map(([path, value]) => [path, encoder.encode(value)]));
  const directories = new Set([""]);
  for (const path of files.keys()) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  let pendingFailure = Boolean(failOncePath);

  class MemoryDirectoryHandle {
    constructor(path = "") {
      this.path = path;
    }

    resolve(name) {
      return this.path ? `${this.path}/${name}` : name;
    }

    async getDirectoryHandle(name, options = {}) {
      const path = this.resolve(name);
      if (!directories.has(path) && !options.create) throw new DOMException("Missing", "NotFoundError");
      directories.add(path);
      return new MemoryDirectoryHandle(path);
    }

    async getFileHandle(name, options = {}) {
      const path = this.resolve(name);
      if (!files.has(path) && !options.create) throw new DOMException("Missing", "NotFoundError");
      if (!files.has(path)) files.set(path, new Uint8Array());
      return {
        getFile: async () => ({
          arrayBuffer: async () => files.get(path).slice().buffer
        }),
        createWritable: async () => {
          let nextData = files.get(path);
          return {
            write: async (data) => {
              nextData = data instanceof Uint8Array ? data.slice() : new Uint8Array(data);
              if (pendingFailure && path === failOncePath) {
                pendingFailure = false;
                files.set(path, new Uint8Array());
                throw new Error("simulated write failure");
              }
            },
            close: async () => files.set(path, nextData)
          };
        }
      };
    }

    async removeEntry(name) {
      files.delete(this.resolve(name));
    }
  }

  return {
    handle: new MemoryDirectoryHandle(),
    text(path) {
      return decoder.decode(files.get(path));
    }
  };
}

test("version comparison handles newer, equal, older, and four-part versions", () => {
  assert.equal(compareVersions("2.2.0", "2.1.9"), 1);
  assert.equal(compareVersions("2.2.0", "2.2.0"), 0);
  assert.equal(compareVersions("2.1.9", "2.2.0"), -1);
  assert.equal(compareVersions("2.2.0.1", "2.2.0"), 1);
  assert.throws(() => compareVersions("v2.2", "2.2.0"), /无法识别版本号/);
});

test("update paths reject traversal and Windows-special paths", () => {
  assert.equal(isSafeUpdatePath("assets/icon-48.png"), true);
  assert.equal(isSafeUpdatePath("../manifest.json"), false);
  assert.equal(isSafeUpdatePath("assets\\icon.png"), false);
  assert.equal(isSafeUpdatePath("CON.txt"), false);
  assert.equal(isSafeUpdatePath("folder/file?.js"), false);
});

test("tar parser strips the repository directory and verifies checksums", () => {
  const tar = createTar([
    { path: "EdgeChatSidebar-main/manifest.json", data: "{\"version\":\"2.2.0\"}" },
    { path: "EdgeChatSidebar-main/assets/icon.svg", data: "<svg></svg>" }
  ]);
  const files = parseTarArchive(tar);
  assert.deepEqual(files.map((file) => file.path), ["manifest.json", "assets/icon.svg"]);
  assert.equal(new TextDecoder().decode(files[1].data), "<svg></svg>");

  const corrupted = tar.slice();
  corrupted[0] ^= 1;
  assert.throws(() => parseTarArchive(corrupted), /校验失败/);
});

test("update archive manifest must match the checked version and extension", () => {
  const currentManifest = {
    name: "Edge Chat Sidebar",
    version: "2.1.0",
    homepage_url: "https://github.com/HaoZhong03/EdgeChatSidebar"
  };
  const manifest = {
    ...currentManifest,
    version: "2.2.0"
  };
  const files = [{ path: "manifest.json", data: encoder.encode(JSON.stringify(manifest)) }];
  assert.doesNotThrow(() => validateUpdateFiles(files, { version: "2.2.0" }, currentManifest));
  assert.throws(
    () => validateUpdateFiles(files, { version: "2.3.0" }, currentManifest),
    /版本与检查结果不一致/
  );
});

test("a partial write failure restores every file from the original version", async () => {
  const directory = createMemoryDirectory({
    "options.js": "old options",
    "manifest.json": "old manifest"
  }, "manifest.json");
  const files = [
    { path: "options.js", data: encoder.encode("new options") },
    { path: "manifest.json", data: encoder.encode("new manifest") }
  ];

  await assert.rejects(
    applyUpdateFiles(directory.handle, files),
    /更新失败，已恢复原版本/
  );
  assert.equal(directory.text("options.js"), "old options");
  assert.equal(directory.text("manifest.json"), "old manifest");
});
