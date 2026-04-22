import {access, readFile, writeFile} from "node:fs/promises";
import path from "node:path";

export const DEFAULT_FOUNDRY_RELEASE_API_URL = "https://foundryvtt.com/_api/packages/release_version/";

export function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable '${name}'`);
    }
    return value;
}

export function getOptionalEnv(name, fallback = undefined) {
    return process.env[name] ?? fallback;
}

export async function readJson(filePath) {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
}

export async function writeJson(filePath, value) {
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeText(filePath, value) {
    await writeFile(filePath, value.endsWith("\n") ? value : `${value}\n`);
}

export async function fileExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch (_error) {
        return false;
    }
}

export function getReleaseTag() {
    return getRequiredEnv("CI_COMMIT_TAG");
}

export function getProjectId() {
    return getRequiredEnv("CI_PROJECT_ID");
}

export function getProjectUrl() {
    return getRequiredEnv("CI_PROJECT_URL");
}

export function getGitLabApiBaseUrl() {
    return getRequiredEnv("CI_API_V4_URL");
}

export function getGitLabReleaseUrl(tag) {
    return `${getProjectUrl()}/-/releases/${encodeURIComponent(tag)}`;
}

export function getReleaseNotesOverridePath(tag) {
    return path.resolve(getOptionalEnv("RELEASE_NOTES_OVERRIDE_DIR", "release-notes"), `${tag}.md`);
}

export function getReleaseOutputDir() {
    return path.resolve(getOptionalEnv("RELEASE_OUTPUT_DIR", ".release"));
}

export function getManifestPath() {
    return path.resolve(getOptionalEnv("BABELE_MANIFEST_PATH", "module/module.json"));
}

export function getReleaseNotesPath() {
    return path.join(getReleaseOutputDir(), "release-notes.md");
}

export function getReleaseContextPath() {
    return path.join(getReleaseOutputDir(), "release-context.json");
}

export function getGitLabAuthHeaders() {
    if (process.env.GITLAB_API_TOKEN) {
        return {"PRIVATE-TOKEN": process.env.GITLAB_API_TOKEN};
    }

    if (process.env.CI_JOB_TOKEN) {
        return {"JOB-TOKEN": process.env.CI_JOB_TOKEN};
    }

    throw new Error("Missing GitLab API authentication. Set GITLAB_API_TOKEN or CI_JOB_TOKEN.");
}

export async function gitlabApiRequest(apiPath, options = {}) {
    const url = `${getGitLabApiBaseUrl()}${apiPath}`;
    return await jsonRequest(url, {
        headers: getGitLabAuthHeaders(),
        ...options,
    });
}

export async function jsonRequest(url, options = {}) {
    const {
        method = "GET",
        headers = {},
        body,
        allowStatus = [],
    } = options;

    const requestHeaders = {
        Accept: "application/json",
        ...headers,
    };

    const init = {
        method,
        headers: requestHeaders,
    };

    if (typeof body !== "undefined") {
        requestHeaders["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    const rawText = await response.text();
    let data = null;
    if (rawText) {
        try {
            data = JSON.parse(rawText);
        } catch (_error) {
            data = rawText;
        }
    }

    if (!response.ok && !allowStatus.includes(response.status)) {
        throw new Error(`Request to '${url}' failed with ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    }

    return {
        status: response.status,
        data,
        headers: response.headers,
    };
}

export async function collectPaginatedGitLab(apiPath, params = {}) {
    const items = [];
    let page = "1";

    while (page) {
        const searchParams = new URLSearchParams({...params, per_page: "100", page});
        const response = await gitlabApiRequest(`${apiPath}?${searchParams.toString()}`);

        if (Array.isArray(response.data)) {
            items.push(...response.data);
        }

        page = response.headers.get("x-next-page") || "";
    }

    return items;
}

export function classifyIssue(issue) {
    const labels = issue.labels ?? [];
    if (labels.includes("type::bug")) {
        return "Fixed";
    }
    if (labels.includes("type::feature")) {
        return "Added";
    }
    if (labels.includes("type::refactor")) {
        return "Changed";
    }
    return "Other";
}

export function formatIssueLine(issue) {
    const ref = issue.references?.short ?? `#${issue.iid}`;
    const title = issue.title ?? "Untitled issue";
    const webUrl = issue.web_url ? ` ([link](${issue.web_url}))` : "";
    return `- ${ref} ${title}${webUrl}`;
}

export function formatReleaseNotes({tag, milestoneTitle, issues, generatedAt}) {
    const lines = [
        `# Babele ${tag}`,
        "",
        `Generated from milestone \`${milestoneTitle}\` on ${generatedAt}.`,
        "",
    ];

    if (!issues.length) {
        lines.push("No closed issues were found for this milestone.");
        return lines.join("\n");
    }

    const sections = new Map([
        ["Fixed", []],
        ["Added", []],
        ["Changed", []],
        ["Other", []],
    ]);

    [...issues]
        .sort((left, right) => left.iid - right.iid)
        .forEach((issue) => {
            sections.get(classifyIssue(issue)).push(formatIssueLine(issue));
        });

    for (const [heading, issueLines] of sections.entries()) {
        if (!issueLines.length) {
            continue;
        }

        lines.push(`## ${heading}`);
        lines.push("");
        lines.push(...issueLines);
        lines.push("");
    }

    return lines.join("\n").trimEnd();
}

export function buildGitLabReleasePayload({tag, notes, manifest}) {
    return {
        name: `Babele ${tag}`,
        tag_name: tag,
        description: notes,
        milestones: [tag],
        assets: {
            links: [
                {
                    name: "Manifest",
                    url: manifest.manifest,
                    link_type: "package",
                },
                {
                    name: "Package",
                    url: manifest.download,
                    link_type: "package",
                },
            ],
        },
    };
}

export function buildFoundryReleasePayload({manifest, notesUrl, dryRun = false}) {
    const compatibility = {};

    if (typeof manifest.compatibility?.minimum !== "undefined") {
        compatibility.minimum = manifest.compatibility.minimum;
    }

    if (typeof manifest.compatibility?.verified !== "undefined") {
        compatibility.verified = manifest.compatibility.verified;
    }

    if (typeof manifest.compatibility?.maximum !== "undefined") {
        compatibility.maximum = manifest.compatibility.maximum;
    }

    return {
        id: manifest.id,
        "dry-run": dryRun,
        release: {
            version: manifest.version,
            manifest: manifest.manifest,
            notes: notesUrl,
            compatibility,
        },
    };
}
