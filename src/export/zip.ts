/**
 * A minimal ZIP writer. Files are stored without compression: most of a bundle is already
 * compressed font data, and static hosts compress the rest in transit. Every timestamp is
 * the same fixed value, so one project always produces identical archive bytes.
 */
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1 January 2000 in the MS-DOS format that ZIP uses. */
const DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const UTF8_FLAG = 0x0800;

export function createZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const entries = [...files].map(([path, data]) => ({
    name: encoder.encode(path),
    data,
    crc: crc32(data),
  }));

  const size = entries.reduce(
    (total, e) => total + 30 + e.name.length + e.data.length + 46 + e.name.length,
    22,
  );
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;
  const u16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };
  const bytes = (value: Uint8Array) => {
    out.set(value, offset);
    offset += value.length;
  };

  const locations: number[] = [];
  for (const entry of entries) {
    locations.push(offset);
    u32(0x04034b50); // Local file header.
    u16(20); // Version needed.
    u16(UTF8_FLAG);
    u16(0); // Stored.
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0);
    bytes(entry.name);
    bytes(entry.data);
  }

  const directoryStart = offset;
  entries.forEach((entry, i) => {
    u32(0x02014b50); // Central directory header.
    u16(20);
    u16(20);
    u16(UTF8_FLAG);
    u16(0);
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(locations[i]!);
    bytes(entry.name);
  });
  const directorySize = offset - directoryStart;

  u32(0x06054b50); // End of central directory.
  u16(0);
  u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(directorySize);
  u32(directoryStart);
  u16(0);
  return out;
}
