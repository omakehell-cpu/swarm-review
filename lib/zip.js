'use strict';

// A zip writer, because EPUB is a zip and this app already refuses to take
// a dependency it can write in sixty lines.
//
// It writes the one shape EPUB needs: stored or deflated entries, no
// directories, no zip64, no encryption. The first entry can be forced to
// "stored" because the EPUB specification requires the mimetype file to be
// uncompressed and first, which is the whole reason a general-purpose zip
// library would have needed configuring anyway.

const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return ~c >>> 0;
}

// Zip stores a DOS timestamp. Everything here gets the same one, so the
// same story compiled twice produces the same bytes -- which makes a
// diff, a checksum and a test all mean something.
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1 January 1980, the earliest a zip can say

/**
 * @param {Array<{ name: string, data: string|Buffer, store?: boolean }>} entries
 * @returns {Buffer}
 */
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const deflated = entry.store ? data : zlib.deflateRawSync(data, { level: 9 });
    const method = entry.store ? 0 : 8;
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags: none, so no data descriptor
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);            // no extra field
    locals.push(local, name, deflated);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014B50, 0);
    head.writeUInt16LE(20, 4);             // version made by
    head.writeUInt16LE(20, 6);             // version needed
    head.writeUInt16LE(0, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(DOS_TIME, 12);
    head.writeUInt16LE(DOS_DATE, 14);
    head.writeUInt32LE(sum, 16);
    head.writeUInt32LE(deflated.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);

    offset += local.length + name.length + deflated.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

module.exports = { zip, crc32 };
