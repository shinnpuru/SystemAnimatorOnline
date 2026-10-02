// Local asset resolution shared by ZIP, folder and multi-file imports.
export function normalizePath(path) {
  const parts = [];
  for (const part of path.replace(/\\/g, '/').normalize('NFC').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

export function decodeZipName(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('shift-jis').decode(bytes); }
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', webp: 'image/webp', gif: 'image/gif', tga: 'application/octet-stream' };
export const isModel = name => /\.(pmx|pmd)$/i.test(name);
export const isMotion = name => /\.vmd$/i.test(name);

export async function collectAssets(files, Zip) {
  const assets = new Map();
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const zip = await Zip.loadAsync(file, { decodeFileName: decodeZipName });
      // Decode one entry at a time to avoid keeping all decompressed buffers alive.
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || /(^|\/)__MACOSX\//.test(entry.name)) continue;
        const path = normalizePath(entry.name);
        const bytes = await entry.async('uint8array');
        assets.set(path, new Blob([bytes], { type: MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream' }));
      }
    } else {
      assets.set(normalizePath(file.webkitRelativePath || file.relativePath || file.name), file);
    }
  }
  return assets;
}

export function findAsset(assets, path) {
  const normalized = normalizePath(path);
  if (assets.has(normalized)) return normalized;
  const folded = normalized.toLowerCase();
  const matches = [...assets.keys()].filter(key => key.toLowerCase() === folded);
  if (matches.length === 1) return matches[0];
  const basename = folded.split('/').pop();
  const fallback = [...assets.keys()].filter(key => key.toLowerCase().split('/').pop() === basename);
  return fallback.length === 1 ? fallback[0] : null;
}

export function createAssetURLs(assets, baseURL) {
  const urls = new Map();
  return {
    resolve(url) {
      if (url.startsWith('data:') || url.startsWith('blob:')) return url;
      const parsed = new URL(url, baseURL);
      const base = new URL(baseURL);
      // Never fetch texture URLs embedded in an imported model over the network.
      if (parsed.origin !== base.origin || !parsed.pathname.startsWith(base.pathname)) return null;
      const path = decodeURIComponent(parsed.pathname.slice(base.pathname.length));
      const key = findAsset(assets, path);
      if (!key) return null;
      if (!urls.has(key)) urls.set(key, URL.createObjectURL(assets.get(key)));
      return urls.get(key);
    },
    dispose() { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); }
  };
}

export async function droppedFiles(items) {
  async function walk(entry, prefix = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      Object.defineProperty(file, 'relativePath', { value: prefix + file.name });
      return [file];
    }
    const reader = entry.createReader();
    const result = [];
    // Directory readers return batches; a single read can omit files.
    while (true) {
      const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!entries.length) break;
      for (const child of entries) result.push(...await walk(child, prefix + entry.name + '/'));
    }
    return result;
  }
  const entries = Array.from(items).filter(item => item.kind === 'file').map(item => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));
  const result = [];
  for (const { entry, file } of entries) {
    if (entry) result.push(...await walk(entry));
    else if (file) result.push(file);
  }
  return result;
}

export function coverRect(sourceWidth, sourceHeight, width, height) {
  const ratio = Math.max(width / sourceWidth, height / sourceHeight);
  const cropWidth = width / ratio, cropHeight = height / ratio;
  return [(sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight];
}
