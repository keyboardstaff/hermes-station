// macOS APFS stores .epub as a directory; browser fetch() can't read it
// (ERR_ACCESS_DENIED). Re-package via File System Access API into a real ZIP.
//
// Pure, zero-React utility extracted from Composer (owner-review D7). Kept
// dependency-free so it can be unit-tested in isolation.

interface EpubFileEntry {
  path: string;
  blob: Blob;
}

export async function zipEpubDirectory(dirFile: File): Promise<File> {
  try {
    const entry = (dirFile as File & { webkitGetAsEntry?: () => FileSystemEntry }).webkitGetAsEntry?.();
    if (!entry?.isDirectory) return dirFile;

    const files = await readDirContents(entry as FileSystemDirectoryEntry);
    if (files.length === 0) return dirFile;

    const names = files.map((f) => f.path);
    const data: Uint8Array[] = await Promise.all(
      files.map((f) => f.blob.arrayBuffer().then((b) => new Uint8Array(b))),
    );

    const zipBuffer = buildZipArch(names, data);
    return new File([zipBuffer], dirFile.name, { type: "application/epub+zip" });
  } catch {
    return dirFile;
  }
}

function readDirContents(dir: FileSystemDirectoryEntry): Promise<EpubFileEntry[]> {
  return new Promise((resolve) => {
    const reader = dir.createReader();
    const collectFiles: EpubFileEntry[] = [];

    reader.readEntries((entries: FileSystemEntry[]) => {
      if (entries.length === 0) { resolve(collectFiles); return; }

      void Promise.all(
        Array.from(entries).map((entry) => {
          if (entry.isFile) {
            return new Promise<void>((res, rej) => {
              (entry as FileSystemFileEntry).file((f: File) => {
                collectFiles.push({ path: entry.fullPath.slice(dir.fullPath.length + 1), blob: f });
                res();
              }, rej);
            });
          }
          if (entry.isDirectory) {
            return readDirContents(entry as FileSystemDirectoryEntry).then((subFiles) => {
              collectFiles.push(...subFiles.map((f) => ({ ...f, path: `${entry.name}/${f.path}` })));
              return undefined;
            });
          }
          return Promise.resolve();
        })
      ).then(() => {
        if (collectFiles.length > 0) return readDirContents(dir);
        return collectFiles;
      });
    });
  });
}

/** Zero-deps ZIP builder; first file ("mimetype") stored uncompressed at offset 30. */
function buildZipArch(names: string[], data: Uint8Array[]): ArrayBuffer {
  const enc = new TextEncoder();
  let offset = 0;
  let buf: ArrayBuffer = new ArrayBuffer(8192);        // grow as needed
  let view = new DataView(buf);

  const ensureSize = (need: number) => {
    if (need > buf.byteLength) {
      const oldBuf = buf;
      buf = new ArrayBuffer(Math.max(need, oldBuf.byteLength * 2));
      view = new DataView(buf);
      new Uint8Array(buf).set(new Uint8Array(oldBuf));
    }
  };

  const w32 = (off: number, v: number) => { view.setUint32(off, v, true); };
  const w16 = (off: number, v: number) => { view.setUint16(off, v, true); };

  const cdEntries: Array<{ off: number }> = [];

  for (let i = 0; i < names.length; i++) {
    const nameBytes = enc.encode(names[i]);
    const dataLen = data[i].byteLength;

    const nameLen = nameBytes.length;
    const localHdrSize = 30 + nameLen;
    const paddedLocal = localHdrSize + ((dataLen % 4 !== 0) ? (4 - dataLen % 4) : 0);
    const localSize = paddedLocal;

    const localOff = offset;
    ensureSize(offset + 30 + nameLen + dataLen);

    w32(offset, 0x04034b50); offset += 4;
    w16(offset, 20); offset += 2;
    w16(offset, 0); offset += 2;
    w16(offset, i === 0 ? 0 : 8); offset += 2;  // store vs deflate
    w16(offset, 0); offset += 2;
    w16(offset, 0); offset += 2;
    w32(offset, crc32(data[i])); offset += 4;
    w32(offset, dataLen); offset += 4;
    w32(offset, dataLen); offset += 4;
    w16(offset, nameLen); offset += 2;
    w16(offset, 0); offset += 2;
    w16(offset, 0); offset += 2;
    w16(offset, 0); offset += 2;
    w16(offset, 0); offset += 2;
    w32(offset, 0); offset += 4;
    ensureSize(offset + nameLen);
    view.setUint8(offset++, nameBytes[0]);
    for (let j = 1; j < nameLen; j++) view.setUint8(offset++, nameBytes[j]);

    ensureSize(offset + dataLen);
    for (let j = 0; j < dataLen; j++) view.setUint8(offset++, data[i][j]);

    offset = localOff + localSize;

    cdEntries.push({ off: localOff });
  }

  ensureSize(offset + 46 * names.length);

  for (let i = 0; i < names.length; i++) {
    const nameBytes = enc.encode(names[i]);
    const dataLen = data[i].byteLength;

    ensureSize(offset + 46 + nameBytes.length);
    w32(offset, 0x02014b50); offset += 4;
    w16(offset, 20); offset += 2;
    w16(offset, 20); offset += 2;
    w16(offset, 0); offset += 2;
    w16(offset, i === 0 ? 0 : 8); offset += 2;
    w16(offset, 0); offset += 2;
    w16(offset, 0); offset += 2;
    w32(offset, crc32(data[i])); offset += 4;
    w32(offset, dataLen); offset += 4;
    w32(offset, dataLen); offset += 4;
    w16(offset, nameBytes.length); offset += 2;
    w16(offset, 0); offset += 2;
    w16(offset, 0); offset += 2;
    w16(offset, 0); offset += 2;
    w16(offset, 0); offset += 2;
    w32(offset, 0); offset += 4;
    w32(offset, cdEntries[i].off); offset += 4;
    ensureSize(offset + nameBytes.length);
    view.setUint8(offset++, nameBytes[0]);
    for (let j = 1; j < nameBytes.length; j++) view.setUint8(offset++, nameBytes[j]);
  }

  const cdEnd = offset;
  ensureSize(offset + 22);

  w32(offset, 0x06054b50); offset += 4;
  w16(offset, 0); offset += 2;
  w16(offset, 0); offset += 2;
  w16(offset, names.length); offset += 2;
  w16(offset, names.length); offset += 2;
  w32(offset, offset - cdEnd); offset += 4;
  w32(offset, cdEnd); offset += 4;
  w16(offset, 0); offset += 2;

  return buf.slice(0, offset);
}

const crcTable: number[] = (() => {
  const table: number[] = new Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
