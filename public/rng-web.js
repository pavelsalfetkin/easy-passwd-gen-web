/**
 * Криптостойкий источник случайности для браузера.
 * getRandomValues доступен и на http-страницах, поэтому генерация работает
 * даже без secure context (в отличие от service worker и установки PWA).
 */
export function webRandomInt(maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError("maxExclusive должен быть положительным целым числом");
    }

    const range = 0x100000000;
    const limit = Math.floor(range / maxExclusive) * maxExclusive;
    const buffer = new Uint32Array(1);

    let value = 0;
    do {
        crypto.getRandomValues(buffer);
        value = buffer[0];
    } while (value >= limit);

    return value % maxExclusive;
}
