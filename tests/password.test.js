import test from "node:test";
import assert from "node:assert/strict";

import {
    ALPHABETS,
    DEFAULT_OPTIONS,
    LIMITS,
    PasswordGenerationError,
    buildPool,
    generatePassword,
    generatePasswords,
} from "../shared/generator.js";
import { parseOptions } from "../shared/options.js";
import { nodeRandomInt } from "../src/rng-node.js";

function sequenceRandom(values) {
    let index = 0;
    return (max) => {
        const value = values[index % values.length];
        index += 1;
        return value % max;
    };
}

function hasCharacterFrom(password, source) {
    return [...source].some((character) => password.includes(character));
}

test("generatePasswords соблюдает длину и количество", () => {
    const options = { ...DEFAULT_OPTIONS, length: 16, count: 5 };
    const passwords = generatePasswords(options, nodeRandomInt);

    assert.equal(passwords.length, 5);
    for (const password of passwords) {
        assert.equal(password.length, 16);
    }
});

test("каждый включённый набор символов присутствует в пароле", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const password = generatePassword({ ...DEFAULT_OPTIONS, length: 4 }, nodeRandomInt);
        assert.ok(hasCharacterFrom(password, ALPHABETS.letters));
        assert.ok(hasCharacterFrom(password, ALPHABETS.digits));
        assert.ok(hasCharacterFrom(password, ALPHABETS.symbols));
    }
});

test("отключённые категории не попадают в пароль", () => {
    const options = { length: 12, letters: false, digits: false, symbols: true, count: 10 };
    const pool = ALPHABETS.symbols;

    for (const password of generatePasswords(options, nodeRandomInt)) {
        for (const character of password) {
            assert.ok(pool.includes(character), `символ ${character} не из разрешённого набора`);
        }
    }
});

test("детерминированный RNG: гарантия категорий не зависит от случайности", () => {
    const password = generatePassword({ ...DEFAULT_OPTIONS, length: 8 }, () => 0);

    assert.equal(password.length, 8);
    assert.ok(password.includes("a"));
    assert.ok(password.includes("0"));
    assert.ok(password.includes("!"));
    assert.equal(new Set(password).size, 3);
});

test("перемешивание сохраняет состав пароля", () => {
    const password = generatePassword({ ...DEFAULT_OPTIONS, length: 10 }, sequenceRandom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    assert.equal(password.length, 10);
    assert.ok(hasCharacterFrom(password, ALPHABETS.letters));
    assert.ok(hasCharacterFrom(password, ALPHABETS.digits));
    assert.ok(hasCharacterFrom(password, ALPHABETS.symbols));
});

test("пул строится только из включённых категорий", () => {
    assert.equal(buildPool({ letters: true, digits: false, symbols: false }), ALPHABETS.letters);
    assert.equal(buildPool({ letters: false, digits: true, symbols: false }), ALPHABETS.digits);
    assert.equal(buildPool({ letters: false, digits: false, symbols: true }), ALPHABETS.symbols);
});

test("без включённых категорий выбрасывается NO_CATEGORIES", () => {
    assert.throws(
        () => generatePassword({ ...DEFAULT_OPTIONS, letters: false, digits: false, symbols: false }, nodeRandomInt),
        (error) => error instanceof PasswordGenerationError && error.code === "NO_CATEGORIES",
    );
});

test("длина меньше числа категорий выбрасывает TOO_SHORT", () => {
    assert.throws(
        () => generatePassword({ ...DEFAULT_OPTIONS, length: 2 }, nodeRandomInt),
        (error) => error instanceof PasswordGenerationError && error.code === "TOO_SHORT",
    );
});

test("без randomInt генератор падает явно", () => {
    assert.throws(() => generatePassword(DEFAULT_OPTIONS), TypeError);
});

test("parseOptions подставляет значения по умолчанию", () => {
    const { options, errors } = parseOptions({});
    assert.deepEqual(errors, []);
    assert.deepEqual(options, DEFAULT_OPTIONS);
});

test("parseOptions нормализует строки query-параметров", () => {
    const { options, errors } = parseOptions({
        length: "16",
        letters: "false",
        digits: "1",
        symbols: "0",
        count: "2",
    });

    assert.deepEqual(errors, []);
    assert.deepEqual(options, {
        length: 16,
        letters: false,
        digits: true,
        symbols: false,
        count: 2,
    });
});

test("parseOptions отклоняет неизвестные параметры", () => {
    const { errors } = parseOptions({ size: 8 });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].field, "size");
    assert.match(errors[0].message, /Неизвестный параметр/);
});

test("parseOptions проверяет диапазон длины и количества", () => {
    for (const length of [3, 65, "abc", "1.5", 4.5]) {
        const { errors } = parseOptions({ length });
        assert.ok(errors.some((error) => error.field === "length"), `длина ${length} должна быть отклонена`);
    }

    for (const count of [0, 11, "many"]) {
        const { errors } = parseOptions({ count });
        assert.ok(errors.some((error) => error.field === "count"), `количество ${count} должно быть отклонено`);
    }

    assert.deepEqual(parseOptions({ length: LIMITS.length.min, count: LIMITS.count.min }).errors, []);
    assert.deepEqual(parseOptions({ length: LIMITS.length.max, count: LIMITS.count.max }).errors, []);
});

test("parseOptions требует хотя бы одну категорию", () => {
    const { errors } = parseOptions({ letters: false, digits: false, symbols: false });
    assert.ok(errors.some((error) => error.field === "categories"));
});

test("parseOptions отклоняет небулевы флаги", () => {
    const { errors } = parseOptions({ letters: "maybe" });
    assert.ok(errors.some((error) => error.field === "letters"));
});

test("parseOptions отклоняет не-объект", () => {
    assert.equal(parseOptions([]).errors[0].field, "body");
    assert.equal(parseOptions(null).errors[0].field, "body");
});
