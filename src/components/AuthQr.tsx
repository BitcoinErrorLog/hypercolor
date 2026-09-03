import React, { useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Buffer } from 'buffer';
import QRCode from 'qrcode/lib/core/qrcode';
import { color, space, radius } from '../theme';

/** Display size in points — large enough to scan from a phone ~20–24cm away. */
export const AUTH_QR_SIZE_PT = 220;

const QR_MODULE_SCALE = 8;
const QR_QUIET_ZONE = 2;

export type AuthQrProps = {
  value: string;
  testID?: string;
};

function readByte(buf: Buffer, i: number): number {
  const byte = buf[i];
  if (byte === undefined) {
    throw new Error(`buffer index ${i} is out of range`);
  }
  return byte;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= readByte(buf, i);
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function adler32(buf: Buffer): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + readByte(buf, i)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Uncompressed PNG (zlib stored blocks). No Node stream/zlib/pngjs. */
function rgbaToPngBase64(width: number, height: number, rgba: Buffer): string {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const dest = y * (width * 4 + 1);
    raw[dest] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), dest + 1);
  }

  const stored: Buffer[] = [];
  const max = 65535;
  for (let off = 0; off < raw.length; off += max) {
    const chunk = raw.subarray(off, Math.min(off + max, raw.length));
    const block = Buffer.alloc(5 + chunk.length);
    const last = off + chunk.length >= raw.length;
    block[0] = last ? 1 : 0;
    block.writeUInt16LE(chunk.length, 1);
    block.writeUInt16LE(chunk.length ^ 0xffff, 3);
    block.set(chunk, 5);
    stored.push(block);
  }
  const deflate = Buffer.concat(stored);
  const zlibBody = Buffer.alloc(2 + deflate.length + 4);
  zlibBody[0] = 0x78;
  zlibBody[1] = 0x01;
  zlibBody.set(deflate, 2);
  zlibBody.writeUInt32BE(adler32(raw), 2 + deflate.length);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibBody),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}

/**
 * Encode `value` as a high-contrast PNG data URI (dark modules, white quiet zone).
 * Uses `qrcode` for the matrix and a stored-block PNG encoder (no native QR / pngjs).
 */
export function generateAuthQrDataUri(value: string): string {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const modules = qr.modules;
  if (!modules) {
    throw new Error('Failed to encode authorization QR');
  }

  const moduleCount = modules.size;
  const dim = (moduleCount + QR_QUIET_ZONE * 2) * QR_MODULE_SCALE;
  const rgba = Buffer.alloc(dim * dim * 4, 255);

  for (let y = 0; y < moduleCount; y++) {
    for (let x = 0; x < moduleCount; x++) {
      if (!modules.get(x, y)) continue;
      const originX = (x + QR_QUIET_ZONE) * QR_MODULE_SCALE;
      const originY = (y + QR_QUIET_ZONE) * QR_MODULE_SCALE;
      for (let dy = 0; dy < QR_MODULE_SCALE; dy++) {
        for (let dx = 0; dx < QR_MODULE_SCALE; dx++) {
          const idx = ((originY + dy) * dim + (originX + dx)) * 4;
          rgba[idx] = 0;
          rgba[idx + 1] = 0;
          rgba[idx + 2] = 0;
          rgba[idx + 3] = 255;
        }
      }
    }
  }

  return `data:image/png;base64,${rgbaToPngBase64(dim, dim, rgba)}`;
}

/**
 * High-contrast authorization QR (dark modules on a white quiet zone).
 * Generated in JS via `qrcode` + PNG data URI — no native QR module.
 */
export function AuthQr({ value, testID = 'authQr' }: AuthQrProps) {
  const dataUri = useMemo(() => {
    if (!value) return null;
    try {
      return generateAuthQrDataUri(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!value || !dataUri) {
    return null;
  }

  return (
    <View testID={testID} style={styles.frame} accessibilityLabel="Authorization QR code">
      <Image
        source={{ uri: dataUri }}
        style={styles.image}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'center',
    backgroundColor: color.textOnBrand,
    padding: space.lg,
    borderRadius: radius.md,
  },
  image: {
    width: AUTH_QR_SIZE_PT,
    height: AUTH_QR_SIZE_PT,
  },
});
