const container = document.querySelector("#docs-content");

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === "text") node.textContent = value;
        else if (key === "className") node.className = value;
        else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) {
        if (child !== null && child !== undefined) node.append(child);
    }
    return node;
}

function resolveRef(spec, ref) {
    if (!ref) return null;
    return ref
        .split("/")
        .slice(1)
        .reduce((node, part) => (node ? node[part] : null), spec);
}

function schemaLabel(spec, schema) {
    const resolved = resolveRef(spec, schema?.$ref) || schema || {};
    const type = resolved.type || "object";
    if (resolved.const !== undefined) return `${type} = ${JSON.stringify(resolved.const)}`;
    const parts = [type];
    if (resolved.minimum !== undefined) parts.push(`min ${resolved.minimum}`);
    if (resolved.maximum !== undefined) parts.push(`max ${resolved.maximum}`);
    if (resolved.default !== undefined) parts.push(`по умолчанию ${JSON.stringify(resolved.default)}`);
    return parts.join(", ");
}

function renderParameters(spec, parameters) {
    if (!parameters || !parameters.length) return null;

    const rows = parameters.map((parameter) => {
        const resolved = resolveRef(spec, parameter.$ref) || parameter;
        const schema = resolveRef(spec, resolved.schema?.$ref) || resolved.schema || {};
        return el("tr", {}, [
            el("td", {}, [el("code", { text: resolved.name })]),
            el("td", { text: resolved.in || "query" }),
            el("td", { text: resolved.required ? "да" : "нет" }),
            el("td", {}, [el("code", { text: schemaLabel(spec, schema) })]),
            el("td", { text: resolved.description || "" }),
        ]);
    });

    return el("table", { className: "docs-table" }, [
        el("thead", {}, [
            el("tr", {}, [
                el("th", { text: "Параметр" }),
                el("th", { text: "Где" }),
                el("th", { text: "Обязательный" }),
                el("th", { text: "Тип" }),
                el("th", { text: "Описание" }),
            ]),
        ]),
        el("tbody", {}, rows),
    ]);
}

function renderRequestBody(spec, requestBody) {
    const content = requestBody?.content?.["application/json"];
    if (!content) return null;

    const schema = resolveRef(spec, content.schema?.$ref) || content.schema || {};
    const properties = schema.properties || {};

    const rows = Object.entries(properties).map(([name, property]) =>
        el("tr", {}, [
            el("td", {}, [el("code", { text: name })]),
            el("td", {}, [el("code", { text: schemaLabel(spec, property) })]),
            el("td", { text: property.description || "" }),
        ]),
    );

    const children = [el("p", { text: "Тело запроса (application/json):" })];
    if (rows.length) {
        children.push(
            el("table", { className: "docs-table" }, [
                el("thead", {}, [
                    el("tr", {}, [
                        el("th", { text: "Поле" }),
                        el("th", { text: "Тип" }),
                        el("th", { text: "Описание" }),
                    ]),
                ]),
                el("tbody", {}, rows),
            ]),
        );
    }
    if (content.example) {
        children.push(el("pre", { className: "docs-example", text: JSON.stringify(content.example, null, 2) }));
    }
    return el("div", {}, children);
}

function renderResponses(spec, responses) {
    const rows = Object.entries(responses || {}).map(([status, response]) => {
        const resolved = resolveRef(spec, response.$ref) || response;
        return el("tr", {}, [
            el("td", {}, [el("code", { text: status })]),
            el("td", { text: resolved.description || "" }),
        ]);
    });

    return el("table", { className: "docs-table" }, [
        el("thead", {}, [el("tr", {}, [el("th", { text: "Статус" }), el("th", { text: "Описание" })])]),
        el("tbody", {}, rows),
    ]);
}

function renderOperation(spec, route, method, operation) {
    const title = el("h2", {}, [
        el("span", { className: `method ${method}`, text: method.toUpperCase() }),
        el("span", { className: "endpoint-path", text: route }),
    ]);

    const children = [title];
    if (operation.summary) children.push(el("p", {}, [el("strong", { text: operation.summary })]));
    if (operation.description) children.push(el("p", { text: operation.description }));

    const parameters = renderParameters(spec, operation.parameters);
    if (parameters) children.push(parameters);

    const requestBody = renderRequestBody(spec, operation.requestBody);
    if (requestBody) children.push(requestBody);

    children.push(el("p", { text: "Ответы:" }));
    children.push(renderResponses(spec, operation.responses));

    if (route.startsWith("/api/v1/passwords")) {
        const example =
            method === "get"
                ? `curl "${location.origin}/api/v1/passwords?length=16&count=4"`
                : `curl -X POST "${location.origin}/api/v1/passwords" \\\n  -H "Content-Type: application/json" \\\n  -d '{"length":16,"count":4}'`;
        children.push(el("pre", { className: "docs-example", text: example }));
    }

    return el("section", { className: "docs-section" }, children);
}

function render(spec) {
    container.textContent = "";

    const info = spec.info || {};
    container.append(
        el("section", { className: "docs-section" }, [
            el("h2", { text: `${info.title || "API"} ${info.version || ""}`.trim() }),
            el("p", { text: info.description || "" }),
            el("p", {}, [
                el("span", { text: "Спецификация: " }),
                el("a", { href: "/openapi.json", text: "/openapi.json" }),
            ]),
        ]),
    );

    const aiUsage = spec["x-ai-usage"];
    if (aiUsage) {
        const children = [el("h2", { text: "Использование агентом" })];
        if (aiUsage.summary) children.push(el("p", { text: aiUsage.summary }));
        if (Array.isArray(aiUsage.steps)) {
            children.push(
                el(
                    "ol",
                    {},
                    aiUsage.steps.map((step) => el("li", { text: step })),
                ),
            );
        }
        if (Array.isArray(aiUsage.notes)) {
            children.push(
                el(
                    "ul",
                    {},
                    aiUsage.notes.map((note) => el("li", { text: note })),
                ),
            );
        }
        container.append(el("section", { className: "docs-section" }, children));
    }

    for (const [route, methods] of Object.entries(spec.paths || {})) {
        for (const [method, operation] of Object.entries(methods)) {
            if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
            container.append(renderOperation(spec, route, method, operation));
        }
    }
}

fetch("/openapi.json")
    .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    })
    .then(render)
    .catch((error) => {
        container.textContent = "";
        container.append(
            el("section", { className: "docs-section" }, [
                el("h2", { text: "Не удалось загрузить спецификацию" }),
                el("p", { text: error.message }),
                el("p", {}, [el("a", { href: "/openapi.json", text: "Открыть openapi.json напрямую" })]),
            ]),
        );
    });
