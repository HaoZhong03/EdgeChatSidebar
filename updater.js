const REPOSITORY_OWNER = "HaoZhong03";
const REPOSITORY_NAME = "EdgeChatSidebar";
const UPDATE_BRANCH = "main";
const MAX_COMPRESSED_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_ARCHIVE_BYTES = 96 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 3000;
const TAR_BLOCK_BYTES = 512;

export const UPDATE_PERMISSION_ORIGINS = Object.freeze([
  "https://raw.githubusercontent.com/*",
  "https://codeload.github.com/*"
]);

export const UPDATE_SOURCE = Object.freeze({
  manifestUrl: `https://raw.githubusercontent.com/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/${UPDATE_BRANCH}/manifest.json`,
  archiveUrl: `https://codeload.github.com/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/tar.gz/refs/heads/${UPDATE_BRANCH}`,
  repositoryUrl: `https://github.com/${REPOSITORY_OWNER}/${REPOSITORY_NAME}`
});

function parseVersion(version) {
  const match = String(version || "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`无法识别版本号“${version}”。`);
  return match.slice(1).map((part) => Number(part || 0));
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

async function readJsonResponse(response, description) {
  if (!response.ok) {
    throw new Error(`${description}失败（HTTP ${response.status}）。`);
  }
  try {
    return JSON.parse(await response.text());
  } catch {
    throw new Error(`${description}返回了无效的数据。`);
  }
}

export async function fetchLatestVersion(fetchImpl = globalThis.fetch) {
  const separator = UPDATE_SOURCE.manifestUrl.includes("?") ? "&" : "?";
  const response = await fetchImpl(`${UPDATE_SOURCE.manifestUrl}${separator}t=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  const manifest = await readJsonResponse(response, "检查更新");
  parseVersion(manifest.version);
  if (manifest.name !== "Edge Chat Sidebar") {
    throw new Error("远程更新清单与当前扩展不匹配。");
  }
  return {
    version: manifest.version,
    archiveUrl: UPDATE_SOURCE.archiveUrl,
    repositoryUrl: UPDATE_SOURCE.repositoryUrl
  };
}

function decodeTarText(bytes, start, length) {
  const end = bytes.subarray(start, start + length).indexOf(0);
  const value = bytes.subarray(start, start + (end < 0 ? length : end));
  return new TextDecoder().decode(value);
}

function parseTarOctal(bytes, start, length) {
  const value = decodeTarText(bytes, start, length).replaceAll("\0", "").trim();
  if (!value) return 0;
  if (!/^[0-7]+$/.test(value)) throw new Error("更新包包含无效的 TAR 数值字段。");
  return Number.parseInt(value, 8);
}

function isEmptyTarBlock(bytes, offset) {
  for (let index = offset; index < offset + TAR_BLOCK_BYTES; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function verifyTarChecksum(bytes, offset) {
  const expected = parseTarOctal(bytes, offset + 148, 8);
  let actual = 0;
  for (let index = 0; index < TAR_BLOCK_BYTES; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : bytes[offset + index];
  }
  if (expected !== actual) throw new Error("更新包校验失败，文件可能已损坏。");
}

function isWindowsReservedName(segment) {
  const base = segment.split(".")[0].toUpperCase();
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base);
}

export function isSafeUpdatePath(path) {
  if (!path || path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f]/.test(path)) return false;
  const segments = path.split("/");
  return segments.every((segment) => (
    segment
    && segment !== "."
    && segment !== ".."
    && !/[<>:"|?*]/.test(segment)
    && !/[. ]$/.test(segment)
    && !isWindowsReservedName(segment)
  ));
}

export function parseTarArchive(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const rawEntries = [];
  let offset = 0;

  while (offset + TAR_BLOCK_BYTES <= bytes.byteLength) {
    if (isEmptyTarBlock(bytes, offset)) break;
    verifyTarChecksum(bytes, offset);

    const name = decodeTarText(bytes, offset, 100);
    const prefix = decodeTarText(bytes, offset + 345, 155);
    const fullPath = prefix ? `${prefix}/${name}` : name;
    const size = parseTarOctal(bytes, offset + 124, 12);
    const type = String.fromCharCode(bytes[offset + 156] || 48);
    const dataStart = offset + TAR_BLOCK_BYTES;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(size) || size < 0 || dataEnd > bytes.byteLength) {
      throw new Error("更新包内容不完整。");
    }

    if (type === "0" || type === "\0") {
      rawEntries.push({ path: fullPath, data: bytes.slice(dataStart, dataEnd) });
      if (rawEntries.length > MAX_ARCHIVE_FILES) throw new Error("更新包文件数量异常。");
    } else if (type !== "5" && type !== "x" && type !== "g") {
      throw new Error(`更新包包含不支持的条目类型“${type}”。`);
    }
    offset = dataStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  }

  if (rawEntries.length === 0) throw new Error("更新包中没有可安装的文件。");
  const rootName = rawEntries[0].path.split("/")[0];
  const files = [];
  const seenPaths = new Set();
  for (const entry of rawEntries) {
    const separatorIndex = entry.path.indexOf("/");
    if (separatorIndex < 1 || entry.path.slice(0, separatorIndex) !== rootName) {
      throw new Error("更新包目录结构无效。");
    }
    const relativePath = entry.path.slice(separatorIndex + 1);
    if (!isSafeUpdatePath(relativePath)) throw new Error(`更新包包含不安全的路径“${relativePath}”。`);
    if (seenPaths.has(relativePath)) throw new Error(`更新包包含重复文件“${relativePath}”。`);
    seenPaths.add(relativePath);
    files.push({ path: relativePath, data: entry.data });
  }
  return files;
}

async function readStreamWithLimit(stream, limit, errorMessage) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(errorMessage);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function downloadUpdateFiles(release, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(release.archiveUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`下载更新包失败（HTTP ${response.status}）。`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_COMPRESSED_ARCHIVE_BYTES) throw new Error("更新包大小异常。");
  if (typeof DecompressionStream !== "function") {
    throw new Error("当前浏览器不支持解压更新包，请升级 Edge 后重试。");
  }
  const compressed = response.body
    ? await readStreamWithLimit(response.body, MAX_COMPRESSED_ARCHIVE_BYTES, "更新包大小异常。")
    : new Uint8Array(await response.arrayBuffer());
  if (compressed.byteLength > MAX_COMPRESSED_ARCHIVE_BYTES) throw new Error("更新包大小异常。");
  let extracted;
  try {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
    extracted = await readStreamWithLimit(stream, MAX_EXTRACTED_ARCHIVE_BYTES, "更新包解压后的大小异常。");
  } catch (error) {
    if (error?.message === "更新包解压后的大小异常。") throw error;
    throw new Error("更新包无法解压或已损坏。");
  }
  return parseTarArchive(extracted);
}

async function readHandleFile(directoryHandle, path) {
  const segments = path.split("/");
  let directory = directoryHandle;
  for (const segment of segments.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment);
  }
  const handle = await directory.getFileHandle(segments.at(-1));
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

async function writeHandleFile(directoryHandle, path, data) {
  const segments = path.split("/");
  let directory = directoryHandle;
  for (const segment of segments.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment, { create: true });
  }
  const handle = await directory.getFileHandle(segments.at(-1), { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function removeHandleFile(directoryHandle, path) {
  const segments = path.split("/");
  let directory = directoryHandle;
  for (const segment of segments.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment);
  }
  await directory.removeEntry(segments.at(-1));
}

async function readHandleFileOrNull(directoryHandle, path) {
  try {
    return await readHandleFile(directoryHandle, path);
  } catch (error) {
    if (error?.name === "NotFoundError") return null;
    throw error;
  }
}

function parseManifestBytes(bytes, description) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${description}中的 manifest.json 无效。`);
  }
}

export async function validateUpdateDirectory(directoryHandle, currentManifest) {
  let localBytes;
  try {
    localBytes = await readHandleFile(directoryHandle, "manifest.json");
  } catch (error) {
    if (error?.name === "NotFoundError") {
      throw new Error("所选文件夹中没有 manifest.json，请选择当前加载的扩展文件夹。");
    }
    throw error;
  }
  const localManifest = parseManifestBytes(localBytes, "所选文件夹");
  if (
    localManifest.name !== currentManifest.name
    || localManifest.homepage_url !== currentManifest.homepage_url
    || localManifest.version !== currentManifest.version
  ) {
    throw new Error("所选文件夹不是当前版本的 Edge Chat Sidebar 扩展目录。");
  }
}

export function validateUpdateFiles(files, release, currentManifest) {
  const manifestEntry = files.find((file) => file.path === "manifest.json");
  if (!manifestEntry) throw new Error("更新包缺少 manifest.json。");
  const manifest = parseManifestBytes(manifestEntry.data, "更新包");
  if (
    manifest.name !== currentManifest.name
    || manifest.homepage_url !== currentManifest.homepage_url
    || manifest.version !== release.version
  ) {
    throw new Error("更新包的扩展信息或版本与检查结果不一致，请重新检查更新。");
  }
}

export async function applyUpdateFiles(directoryHandle, files, onProgress = () => {}) {
  const orderedFiles = [...files].sort((left, right) => {
    if (left.path === "manifest.json") return 1;
    if (right.path === "manifest.json") return -1;
    return left.path.localeCompare(right.path);
  });
  const backups = new Map();
  const appliedPaths = [];

  onProgress("正在备份待替换文件……");
  for (const file of orderedFiles) {
    backups.set(file.path, await readHandleFileOrNull(directoryHandle, file.path));
  }

  try {
    for (let index = 0; index < orderedFiles.length; index += 1) {
      const file = orderedFiles[index];
      onProgress(`正在安装更新（${index + 1}/${orderedFiles.length}）……`);
      appliedPaths.push(file.path);
      await writeHandleFile(directoryHandle, file.path, file.data);
    }
  } catch (error) {
    const rollbackErrors = [];
    onProgress("安装未完成，正在恢复原版本……");
    for (const path of appliedPaths.reverse()) {
      try {
        const backup = backups.get(path);
        if (backup === null) await removeHandleFile(directoryHandle, path);
        else await writeHandleFile(directoryHandle, path, backup);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`更新失败且未能完整恢复原版本：${error.message}。请重新下载扩展源码。`);
    }
    throw new Error(`更新失败，已恢复原版本：${error.message}`);
  }
}

export async function installLocalUpdate({
  directoryHandle,
  release,
  currentManifest,
  fetchImpl = globalThis.fetch,
  onProgress = () => {}
}) {
  await validateUpdateDirectory(directoryHandle, currentManifest);
  onProgress("正在下载并校验更新包……");
  const files = await downloadUpdateFiles(release, fetchImpl);
  validateUpdateFiles(files, release, currentManifest);
  await applyUpdateFiles(directoryHandle, files, onProgress);
}
