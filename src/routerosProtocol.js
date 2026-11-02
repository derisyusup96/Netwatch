import { Buffer } from "buffer";

export function encodeLength(length) {
  if (!Number.isInteger(length) || length < 0 || length >= 0x100000000) {
    throw new RangeError("Panjang RouterOS API tidak valid.");
  }
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) {
    return Buffer.from([(length >> 8) | 0x80, length & 0xff]);
  }
  if (length < 0x200000) {
    return Buffer.from([
      (length >> 16) | 0xc0,
      (length >> 8) & 0xff,
      length & 0xff,
    ]);
  }
  if (length < 0x10000000) {
    return Buffer.from([
      (length >> 24) | 0xe0,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff,
    ]);
  }
  const header = Buffer.alloc(5);
  header[0] = 0xf0;
  header.writeUInt32BE(length, 1);
  return header;
}

export function decodeLength(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  if ((first & 0x80) === 0) return { length: first, bytes: 1 };
  if ((first & 0xc0) === 0x80) {
    if (buffer.length - offset < 2) return null;
    return {
      length: ((first & 0x3f) << 8) | buffer[offset + 1],
      bytes: 2,
    };
  }
  if ((first & 0xe0) === 0xc0) {
    if (buffer.length - offset < 3) return null;
    return {
      length:
        ((first & 0x1f) << 16) |
        (buffer[offset + 1] << 8) |
        buffer[offset + 2],
      bytes: 3,
    };
  }
  if ((first & 0xf0) === 0xe0) {
    if (buffer.length - offset < 4) return null;
    return {
      length:
        (first & 0x0f) * 0x1000000 +
        (buffer[offset + 1] << 16) +
        (buffer[offset + 2] << 8) +
        buffer[offset + 3],
      bytes: 4,
    };
  }
  if (first === 0xf0) {
    if (buffer.length - offset < 5) return null;
    return { length: buffer.readUInt32BE(offset + 1), bytes: 5 };
  }
  throw new Error("RouterOS mengirim header panjang yang tidak valid.");
}

export function encodeWord(word) {
  const value = Buffer.from(String(word), "utf8");
  return Buffer.concat([encodeLength(value.length), value]);
}

export function encodeSentence(words) {
  return Buffer.concat([...words.map(encodeWord), encodeLength(0)]);
}

export function parseWord(word) {
  if (!word.startsWith("=")) return [word, null];
  const separator = word.indexOf("=", 1);
  if (separator < 0) return [word.slice(1), ""];
  const value = word.slice(separator + 1);
  return [
    word.slice(1, separator),
    value === "yes" ? "true" : value === "no" ? "false" : value,
  ];
}

export function consumeSentences(input, chunk) {
  let buffer = Buffer.concat([input, Buffer.from(chunk)]);
  const sentences = [];
  let offset = 0;
  let sentenceStart = 0;
  let words = [];

  while (offset < buffer.length) {
    const decoded = decodeLength(buffer, offset);
    if (!decoded) break;
    if (decoded.length > 8 * 1024 * 1024) {
      throw new Error("RouterOS mengirim data API melebihi batas ukuran.");
    }
    const wordStart = offset + decoded.bytes;
    const wordEnd = wordStart + decoded.length;
    if (wordEnd > buffer.length) break;
    offset = wordEnd;
    if (decoded.length === 0) {
      sentences.push(words);
      words = [];
      sentenceStart = offset;
    } else {
      // Ensure decoding uses Buffer's encoding-aware toString implementation.
      // Some RN Uint8Array subclasses stringify as comma-separated byte values.
      words.push(Buffer.from(buffer.subarray(wordStart, wordEnd)).toString("utf8"));
    }
  }

  buffer = buffer.subarray(sentenceStart);
  return { buffer, sentences };
}

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_CONSTANTS = Array.from({ length: 64 }, (_, index) =>
  Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000),
);

function md5(input) {
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = Buffer.alloc(paddedLength);
  input.copy(padded);
  padded[input.length] = 0x80;
  padded.writeUInt32LE((input.length * 8) >>> 0, paddedLength - 8);
  padded.writeUInt32LE(Math.floor((input.length * 8) / 0x100000000), paddedLength - 4);

  let stateA = 0x67452301;
  let stateB = 0xefcdab89;
  let stateC = 0x98badcfe;
  let stateD = 0x10325476;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const block = Array.from({ length: 16 }, (_, index) =>
      padded.readUInt32LE(offset + index * 4),
    );
    let a = stateA;
    let b = stateB;
    let c = stateC;
    let d = stateD;

    for (let index = 0; index < 64; index += 1) {
      let value;
      let wordIndex;
      if (index < 16) {
        value = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        value = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        value = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        value = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }

      const sum = (a + value + MD5_CONSTANTS[index] + block[wordIndex]) >>> 0;
      const shift = MD5_SHIFTS[index];
      const rotated = (sum << shift) | (sum >>> (32 - shift));
      const previousD = d;
      d = c;
      c = b;
      b = (b + rotated) >>> 0;
      a = previousD;
    }

    stateA = (stateA + a) >>> 0;
    stateB = (stateB + b) >>> 0;
    stateC = (stateC + c) >>> 0;
    stateD = (stateD + d) >>> 0;
  }

  const digest = Buffer.alloc(16);
  digest.writeUInt32LE(stateA, 0);
  digest.writeUInt32LE(stateB, 4);
  digest.writeUInt32LE(stateC, 8);
  digest.writeUInt32LE(stateD, 12);
  return digest;
}

export function challengeResponse(password, challengeHex) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(challengeHex)) {
    throw new Error("RouterOS mengirim challenge login yang tidak valid.");
  }
  const challenge = Buffer.from(challengeHex, "hex");
  const digest = md5(
    Buffer.concat([Buffer.from([0]), Buffer.from(password, "utf8"), challenge]),
  );
  return `00${digest.toString("hex")}`;
}
