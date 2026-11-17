import { randomInt } from "node:crypto";

/**
 * Криптостойкий источник случайности для серверной стороны.
 * crypto.randomInt(max) возвращает целое в [0, max) без смещения.
 */
export function nodeRandomInt(maxExclusive) {
    return randomInt(maxExclusive);
}
