import {
    buildFoundryReleasePayload,
    DEFAULT_FOUNDRY_RELEASE_API_URL,
    getGitLabReleaseUrl,
    getManifestPath,
    getOptionalEnv,
    getReleaseTag,
    jsonRequest,
    readJson,
} from "./release-lib.mjs";

const tag = getReleaseTag();
const foundryToken = process.env.FOUNDRY_RELEASE_TOKEN;

if (!foundryToken) {
    throw new Error("Missing required environment variable 'FOUNDRY_RELEASE_TOKEN'");
}

const manifest = await readJson(getManifestPath());
const notesUrl = getOptionalEnv("RELEASE_NOTES_URL", getGitLabReleaseUrl(tag));
const dryRun = getOptionalEnv("FOUNDRY_DRY_RUN", "false") === "true";
const apiUrl = getOptionalEnv("FOUNDRY_RELEASE_API_URL", DEFAULT_FOUNDRY_RELEASE_API_URL);
const payload = buildFoundryReleasePayload({manifest, notesUrl, dryRun});

const response = await jsonRequest(apiUrl, {
    method: "POST",
    headers: {
        Authorization: foundryToken,
    },
    body: payload,
});

console.log(`Babele | ${dryRun ? "validated" : "published"} Foundry release for ${tag}`, response.data);
