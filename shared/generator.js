/**
 * Изоморфный генератор паролей.
 *
 * Модуль не использует Node-специфичных API и импортируется как сервером,
 * так и браузером. Источник случайности передаётся снаружи функцией
 * randomInt(maxExclusive) -> целое в диапазоне [0, maxExclusive).
 */

export const ALPHABETS = Object.freeze({
    letters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits: "0123456789",
    symbols: "!@#$%^&*_-+=",
});

export const CATEGORY_NAMES = Object.freeze(["letters", "digits", "symbols"]);

export const LIMITS = Object.freeze({
    length: Object.freeze({ min: 4, max: 64, default: 8 }),
    count: Object.freeze({ min: 1, max: 10, default: 4 }),
});

export const DEFAULT_OPTIONS = Object.freeze({
    length: LIMITS.length.default,
    letters: true,
    digits: true,
    symbols: true,
    count: LIMITS.count.default,
});

export class PasswordGenerationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "PasswordGenerationError";
        this.code = code;
    }
}

export function enabledCategories(options) {
    return CATEGORY_NAMES.filter((name) => Boolean(options[name]));
}

export function buildPool(options) {
    return enabledCategories(options)
        .map((name) => ALPHABETS[name])
        .join("");
}

function pickRandom(source, randomInt) {
    if (!source.length) {
        throw new PasswordGenerationError("EMPTY_POOL", "Набор символов пуст");
    }
    return source.charAt(randomInt(source.length));
}

export function shuffle(items, randomInt) {
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = randomInt(i + 1);
        const swap = items[i];
        items[i] = items[j];
        items[j] = swap;
    }
    return items;
}

/**
 * Гарантирует по одному символу каждой включённой категории без рекурсии:
 * сначала обязательные символы, затем добор из общего пула и перемешивание.
 */
export function generatePassword(options, randomInt) {
    if (typeof randomInt !== "function") {
        throw new TypeError("randomInt должен быть функцией");
    }

    const length = options.length;
    if (!Number.isInteger(length) || length < 1) {
        throw new PasswordGenerationError("INVALID_LENGTH", "Длина должна быть положительным целым числом");
    }

    const categories = enabledCategories(options);
    if (!categories.length) {
        throw new PasswordGenerationError("NO_CATEGORIES", "Не выбрано ни одной категории символов");
    }
    if (length < categories.length) {
        throw new PasswordGenerationError("TOO_SHORT", "Длина меньше числа включённых категорий");
    }

    const pool = buildPool(options);
    const characters = categories.map((name) => pickRandom(ALPHABETS[name], randomInt));

    while (characters.length < length) {
        characters.push(pickRandom(pool, randomInt));
    }

    return shuffle(characters, randomInt).join("");
}

export function generatePasswords(options, randomInt) {
    const count = options.count ?? DEFAULT_OPTIONS.count;
    if (!Number.isInteger(count) || count < 1) {
        throw new PasswordGenerationError("INVALID_COUNT", "Количество должно быть положительным целым числом");
    }

    return Array.from({ length: count }, () => generatePassword(options, randomInt));
}
