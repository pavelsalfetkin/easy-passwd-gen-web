/**
 * Генерация PNG-иконок без внешних зависимостей (встроенный zlib).
 * Иконки нужны для установки PWA; исходников-картинок в проекте нет.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(currentDir, "..", "public", "icons");

const BACKGROUND = [37, 99, 235];
const FOREGROUND = [255, 255, 255];

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let value = n;
        for (let k = 0; k < 8; k += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[n] = value;
    }
    return table;
})();

function crc32(buffer) {
    let crc = -1;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type, "ascii");
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, rgba) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bit depth
    header[9] = 6; // RGBA
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;

    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflateSync(raw, { level: 9 })),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

function insideRoundedSquare(x, y, radius = 0.22) {
    const nearest = Math.min(x, 1 - x, y, 1 - y);
    if (nearest >= radius) return true;
    const dx = radius - Math.min(x, 1 - x);
    const dy = radius - Math.min(y, 1 - y);
    return dx * dx + dy * dy <= radius * radius;
}

function insideKeyhole(x, y) {
    const dx = x - 0.5;
    const dy = y - 0.42;
    if (dx * dx + dy * dy <= 0.135 * 0.135) return true;
    if (y >= 0.44 && y <= 0.72) {
        const t = (y - 0.44) / 0.28;
        const halfWidth = 0.045 + t * 0.075;
        return Math.abs(dx) <= halfWidth;
    }
    return false;
}

function renderIcon(size, { maskable = false } = {}) {
    const samples = 3;
    const data = Buffer.alloc(size * size * 4);
    const total = samples * samples;

    for (let py = 0; py < size; py += 1) {
        for (let px = 0; px < size; px += 1) {
            let backgroundHits = 0;
            let foregroundHits = 0;

            for (let sy = 0; sy < samples; sy += 1) {
                for (let sx = 0; sx < samples; sx += 1) {
                    const x = (px + (sx + 0.5) / samples) / size;
                    const y = (py + (sy + 0.5) / samples) / size;

                    if (!maskable && !insideRoundedSquare(x, y)) continue;
                    backgroundHits += 1;

                    const keyholeX = maskable ? (x - 0.5) / 0.78 + 0.5 : x;
                    const keyholeY = maskable ? (y - 0.5) / 0.78 + 0.5 : y;
                    if (insideKeyhole(keyholeX, keyholeY)) foregroundHits += 1;
                }
            }

            const alpha = backgroundHits / total;
            const foregroundRatio = backgroundHits ? foregroundHits / backgroundHits : 0;
            const offset = (py * size + px) * 4;

            for (let channel = 0; channel < 3; channel += 1) {
                data[offset + channel] = Math.round(
                    BACKGROUND[channel] + (FOREGROUND[channel] - BACKGROUND[channel]) * foregroundRatio,
                );
            }
            data[offset + 3] = Math.round(alpha * 255);
        }
    }

    return encodePng(size, size, data);
}

const targets = [
    { file: "icon-192.png", size: 192, maskable: false },
    { file: "icon-512.png", size: 512, maskable: false },
    { file: "icon-maskable-512.png", size: 512, maskable: true },
    { file: "apple-touch-icon-180.png", size: 180, maskable: true },
    { file: "favicon-32.png", size: 32, maskable: false },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const target of targets) {
    const buffer = renderIcon(target.size, { maskable: target.maskable });
    writeFileSync(path.join(OUT_DIR, target.file), buffer);
    console.log(`${target.file}: ${buffer.length} байт`);
}

console.log(`Иконки записаны в ${OUT_DIR}`);
