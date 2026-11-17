import { DEFAULT_OPTIONS, generatePasswords } from "/shared/generator.js";
import { parseOptions } from "/shared/options.js";
import { webRandomInt } from "/rng-web.js";

const elements = {
    tabs: Array.from(document.querySelectorAll("[data-tab]")),
    panels: {
        regular: document.querySelector("#panel-regular"),
        custom: document.querySelector("#panel-custom"),
    },
    generateRegular: document.querySelector("#generate-regular"),
    generateCustom: document.querySelector("#generate-custom"),
    lengthButtons: Array.from(document.querySelectorAll("[data-length]")),
    categoryButtons: Array.from(document.querySelectorAll("[data-category]")),
    customError: document.querySelector("#custom-error"),
    passwordList: document.querySelector("#password-list"),
    emptyState: document.querySelector("#empty-state"),
    status: document.querySelector("#status"),
    copyAll: document.querySelector("#copy-all"),
    generateAgain: document.querySelector("#generate-again"),
    installButton: document.querySelector("#install-button"),
    installHint: document.querySelector("#install-hint"),
};

const state = {
    mode: "regular",
    length: 8,
    categories: { letters: true, digits: true, symbols: true },
    lastOptions: null,
};

let statusTimer = null;

function showStatus(message, tone = "info") {
    elements.status.textContent = message;
    elements.status.className = "status";
    if (tone !== "info") {
        elements.status.classList.add(`is-${tone}`);
    }
    if (statusTimer) clearTimeout(statusTimer);
    if (message) {
        statusTimer = setTimeout(() => {
            elements.status.textContent = "";
            elements.status.className = "status";
        }, 4000);
    }
}

function activateTab(mode) {
    state.mode = mode;
    for (const tab of elements.tabs) {
        const selected = tab.dataset.tab === mode;
        tab.setAttribute("aria-selected", String(selected));
        tab.classList.toggle("is-active", selected);
        tab.tabIndex = selected ? 0 : -1;
    }
    elements.panels.regular.hidden = mode !== "regular";
    elements.panels.custom.hidden = mode !== "custom";
}

function currentOptions() {
    if (state.mode === "regular") {
        return { ...DEFAULT_OPTIONS };
    }
    return {
        length: state.length,
        letters: state.categories.letters,
        digits: state.categories.digits,
        symbols: state.categories.symbols,
        count: DEFAULT_OPTIONS.count,
    };
}

function updateLengthUi() {
    for (const button of elements.lengthButtons) {
        button.setAttribute("aria-checked", String(Number(button.dataset.length) === state.length));
    }
}

function updateCategoryUi() {
    for (const button of elements.categoryButtons) {
        const enabled = Boolean(state.categories[button.dataset.category]);
        button.setAttribute("aria-pressed", String(enabled));
        button.classList.toggle("is-on", enabled);
    }

    const { errors } = parseOptions({
        length: state.length,
        ...state.categories,
        count: DEFAULT_OPTIONS.count,
    });
    const categoryError = errors.find((error) => error.field === "categories");
    elements.customError.hidden = !categoryError;
    elements.generateCustom.disabled = Boolean(categoryError);
}

function renderPasswords(passwords) {
    elements.passwordList.textContent = "";
    elements.emptyState.hidden = passwords.length > 0;
    elements.copyAll.hidden = passwords.length === 0;
    elements.generateAgain.hidden = passwords.length === 0;

    passwords.forEach((password, index) => {
        const item = document.createElement("li");
        item.className = "password-card";

        const code = document.createElement("code");
        code.textContent = password;

        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "copy";
        copyButton.textContent = "Копировать";
        copyButton.setAttribute("aria-label", `Скопировать пароль ${index + 1}`);
        copyButton.addEventListener("click", async () => {
            const copied = await copyText(password);
            showStatus(
                copied ? `Пароль ${index + 1} скопирован.` : "Не удалось скопировать. Выделите пароль вручную.",
                copied ? "ok" : "error",
            );
        });

        item.append(code, copyButton);
        elements.passwordList.append(item);
    });
}

async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            /* переходим к резервному способу */
        }
    }

    const area = document.createElement("textarea");
    area.className = "visually-hidden-textarea";
    area.value = text;
    area.setAttribute("readonly", "");
    document.body.append(area);
    area.select();

    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    }
    area.remove();
    return copied;
}

function generate() {
    const options = currentOptions();
    const { errors } = parseOptions(options);
    if (errors.length) {
        showStatus(errors[0].message, "error");
        return;
    }

    state.lastOptions = options;
    const passwords = generatePasswords(options, webRandomInt);
    renderPasswords(passwords);
    showStatus("Готово. Пароли созданы на этом устройстве.", "ok");
}

for (const tab of elements.tabs) {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
    tab.addEventListener("keydown", (event) => {
        const index = elements.tabs.indexOf(tab);
        let nextIndex = null;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % elements.tabs.length;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + elements.tabs.length) % elements.tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = elements.tabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        const nextTab = elements.tabs[nextIndex];
        activateTab(nextTab.dataset.tab);
        nextTab.focus();
    });
}

for (const button of elements.lengthButtons) {
    button.addEventListener("click", () => {
        state.length = Number(button.dataset.length);
        updateLengthUi();
        updateCategoryUi();
    });
}

for (const button of elements.categoryButtons) {
    button.addEventListener("click", () => {
        const name = button.dataset.category;
        state.categories[name] = !state.categories[name];
        updateCategoryUi();
    });
}

elements.generateRegular.addEventListener("click", () => {
    activateTab("regular");
    generate();
});

elements.generateCustom.addEventListener("click", () => {
    activateTab("custom");
    generate();
});

elements.generateAgain.addEventListener("click", () => {
    if (!state.lastOptions) return;
    const passwords = generatePasswords(state.lastOptions, webRandomInt);
    renderPasswords(passwords);
    showStatus("Новая партия паролей готова.", "ok");
});

elements.copyAll.addEventListener("click", async () => {
    const passwords = Array.from(elements.passwordList.querySelectorAll("code")).map((node) => node.textContent);
    if (!passwords.length) return;
    const copied = await copyText(passwords.join("\n"));
    showStatus(copied ? "Все пароли скопированы." : "Не удалось скопировать пароли.", copied ? "ok" : "error");
});

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installButton.hidden = false;
});

elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    showStatus(
        choice.outcome === "accepted" ? "Приложение установлено." : "Установка отменена.",
        choice.outcome === "accepted" ? "ok" : "warn",
    );
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
});

window.addEventListener("appinstalled", () => {
    elements.installButton.hidden = true;
    showStatus("Приложение установлено. Теперь оно доступно офлайн.", "ok");
});

const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if (isIos && !isStandalone) {
    elements.installHint.hidden = false;
}

window.addEventListener("offline", () => {
    showStatus("Нет сети. Пароли всё равно генерируются на устройстве.", "warn");
});

window.addEventListener("online", () => {
    showStatus("Соединение восстановлено.", "ok");
});

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((error) => {
            console.warn("Service worker не зарегистрирован:", error.message);
        });
    });
}

updateLengthUi();
updateCategoryUi();
