import {readFile, writeFile} from "node:fs/promises";

const routesPath = process.env.MOCK_FETCH_ROUTES_FILE;
const requestsPath = process.env.MOCK_FETCH_REQUESTS_FILE;

if (!routesPath || !requestsPath) {
    throw new Error("mock-fetch-loader requires MOCK_FETCH_ROUTES_FILE and MOCK_FETCH_REQUESTS_FILE");
}

const routes = JSON.parse(await readFile(routesPath, "utf8"));
const requests = [];

async function persistRequests() {
    await writeFile(requestsPath, JSON.stringify(requests, null, 2));
}

globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    const headers = init.headers ?? {};
    const request = {
        method,
        url: String(url),
        headers,
        body,
    };
    requests.push(request);
    await persistRequests();

    const route = routes.find((candidate) => {
        if (candidate.method !== method) {
            return false;
        }

        if (candidate.match === "exact") {
            return candidate.url === request.url;
        }

        if (candidate.match === "prefix") {
            return request.url.startsWith(candidate.url);
        }

        return false;
    });

    if (!route) {
        throw new Error(`Unexpected fetch: ${method} ${request.url}`);
    }

    const status = route.status ?? 200;
    const responseHeaders = new Map(Object.entries(route.headers ?? {}));
    const payload = route.body ?? {};

    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get(name) {
                return responseHeaders.get(name.toLowerCase()) ?? responseHeaders.get(name) ?? null;
            },
        },
        async text() {
            return JSON.stringify(payload);
        },
    };
};
