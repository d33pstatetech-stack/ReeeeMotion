#!/usr/bin/env node
// scripts/make-test-png.js
//
// Generate a valid 320x240 solid-color PNG at a path given on the command line.
// Pure Node, no npm deps, no ffmpeg. Portable substitute for
// `ffmpeg -f lavfi color=c=red:...` so HTML-encoded curl wrappers / bashers
// can produce test PNGs without quoting issues.
//
// Usage: node scripts/make-test-png.js <output-path>
//
// Optional: --width=N --height=N (default 320x240) and --rgb=R,G,B (default 220,50,50).

'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');

function parseArgs(argv) {
  const opts = { out: argv[2], width: 320, height: 240, rgb: [220, 50, 50] };
  for (const a of argv.slice(3)) {
    if (a.startsWith('--width=')) opts.width = Number(a.slice('--width='.length)) || opts.width;
    else if (a.startsWith('--height=')) opts.height = Number(a.slice('--height='.length)) || opts.height;
    else if (a.startsWith('--rgb=')) {
      // Fail loudly on a malformed --rgb= so a typo doesn't silently
      // produce a "test PNG" of an unexpected color in CI.
      const raw = a.slice('--rgb='.length);
      const parts = raw.split(',').map(Number);
      if (parts.length !== 3 || !parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) {
        process.stderr.write(`error: --rgb must be R,G,B with 0<=N<=255; got "${raw}"\n`);
        process.exit(2);
      }
      opts.rgb = parts;
    }
  }
  return opts;
}

// Standard CRC-32 (reflected polynomial 0xEDB88320) used by the PNG spec.
// `>>> 0` keeps every intermediate value an unsigned 32-bit int (JS bitwise
// ops are signed by default, which would corrupt the CRC).
function buildCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
}
const CRC_TABLE = buildCrcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// PNG chunk: [length BE4][type ASCII4][data][crc-over-(type+data) BE4].
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makeSolidPNG(width, height, [r, g, b]) {
  // Cap dimensions so a stray --width=999999 can't blow up the row buffer
  // (~3 GB allocation for a million-pixel image). 8192 is plenty for any
  // test PNG this script will ever be asked to make.
  if (!Number.isInteger(width) || width <= 0 || width > 8192) {
    throw new Error(`bad width: ${width} (must be 1..8192)`);
  }
  if (!Number.isInteger(height) || height <= 0 || height > 8192) {
    throw new Error(`bad height: ${height} (must be 1..8192)`);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: width, height, bitDepth=8, colorType=2 (RGB), compression=0,
  // filter=0, interlace=0. All big-endian.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: each scanline row is prefixed with a 1-byte filter (0=None),
  // followed by RGB triples. The whole stream is then zlib-deflated.
  const rowBytes = 1 + width * 3;
  const row = Buffer.alloc(rowBytes);
  row[0] = 0; // filter: None
  for (let i = 1; i < rowBytes; i += 3) {
    row[i] = r;
    row[i + 1] = g;
    row[i + 2] = b;
  }
  const allRows = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) row.copy(allRows, y * rowBytes);
  const idat = zlib.deflateSync(allRows);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  const opts = parseArgs(process.argv);
  if (!opts.out) {
    process.stderr.write('usage: node scripts/make-test-png.js <output.png> [--width=N] [--height=N] [--rgb=R,G,B]\n');
    process.exit(2);
  }
  const png = makeSolidPNG(opts.width, opts.height, opts.rgb);
  fs.writeFileSync(opts.out, png);
  process.stdout.write(`${opts.out}\n`);
}

main();
