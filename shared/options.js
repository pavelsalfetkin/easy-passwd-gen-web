/**
 * Единая нормализация и валидация параметров для API и браузерного UI.
 * Неизвестные параметры считаются ошибкой: агенту проще заметить опечатку,
 * чем получить молча проигнорированный аргумент.
 */

import { CATEGORY_NAMES, DEFAULT_OPTIONS, LIMITS, enabledCategories } from "./generator.js";

export const FIELDS = Object.freeze(["length", "letters", "digits", "symbols", "count"]);

function toInteger(value) {
    if (typeof value === "number") {
        return Number.isInteger(value) ? value : null;
    }
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
        return Number(value.trim());
    }
    return null;
}

function toBoolean(value) {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === 0) return value === 1;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(normalized)) return true;
        if (["false", "0", "no", "off"].includes(normalized)) return false;
    }
    return null;
}

function rangeError(field, value, limit, label) {
    if (value < limit.min || value > limit.max) {
        return {
            field,
            message: `${label} должна быть от ${limit.min} до ${limit.max}`,
        };
    }
    return null;
}

export function parseOptions(raw = {}) {
    const errors = [];

    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return {
            options: { ...DEFAULT_OPTIONS },
            errors: [{ field: "body", message: "Ожидается объект с параметрами" }],
        };
    }

    for (const key of Object.keys(raw)) {
        if (!FIELDS.includes(key)) {
            errors.push({
                field: key,
                message: `Неизвестный параметр «${key}». Допустимые: ${FIELDS.join(", ")}`,
            });
        }
    }

    const options = { ...DEFAULT_OPTIONS };

    if (raw.length !== undefined) {
        const value = toInteger(raw.length);
        if (value === null) {
            errors.push({ field: "length", message: "Длина должна быть целым числом" });
        } else {
            options.length = value;
        }
    }

    if (raw.count !== undefined) {
        const value = toInteger(raw.count);
        if (value === null) {
            errors.push({ field: "count", message: "Количество должно быть целым числом" });
        } else {
            options.count = value;
        }
    }

    for (const name of CATEGORY_NAMES) {
        if (raw[name] === undefined) continue;
        const value = toBoolean(raw[name]);
        if (value === null) {
            errors.push({ field: name, message: "Ожидается true или false" });
        } else {
            options[name] = value;
        }
    }

    const lengthError = rangeError("length", options.length, LIMITS.length, "Длина");
    if (lengthError) errors.push(lengthError);

    const countError = rangeError("count", options.count, LIMITS.count, "Количество");
    if (countError) errors.push(countError);

    const categories = enabledCategories(options);
    if (!categories.length) {
        errors.push({
            field: "categories",
            message: "Включите хотя бы одну категорию: letters, digits или symbols",
        });
    } else if (options.length < categories.length) {
        errors.push({
            field: "length",
            message: "Длина меньше числа включённых категорий",
        });
    }

    return { options, errors };
}

export function validateOptions(options) {
    return parseOptions(options).errors;
}
