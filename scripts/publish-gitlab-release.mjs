import {
    buildGitLabReleasePayload,
    getManifestPath,
    getProjectId,
    getReleaseNotesPath,
    getReleaseTag,
    getGitLabReleaseUrl,
    gitlabApiRequest,
    readJson,
} from "./release-lib.mjs";
import {readFile} from "node:fs/promises";

const tag = getReleaseTag();
const manifest = await readJson(getManifestPath());
const notes = await readFile(getReleaseNotesPath(), "utf8");
const payload = buildGitLabReleasePayload({tag, notes, manifest});

const releasePath = `/projects/${encodeURIComponent(getProjectId())}/releases/${encodeURIComponent(tag)}`;
const existing = await gitlabApiRequest(releasePath, {allowStatus: [404]});

if (existing.status === 404) {
    await gitlabApiRequest(`/projects/${encodeURIComponent(getProjectId())}/releases`, {
        method: "POST",
        body: payload,
    });
    console.log(`Babele | created GitLab release for ${tag}`, {releaseUrl: getGitLabReleaseUrl(tag)});
} else {
    await gitlabApiRequest(releasePath, {
        method: "PUT",
        body: {
            name: payload.name,
            description: payload.description,
            milestones: payload.milestones,
        },
    });
    console.log(`Babele | updated GitLab release for ${tag}`, {releaseUrl: getGitLabReleaseUrl(tag)});
}
