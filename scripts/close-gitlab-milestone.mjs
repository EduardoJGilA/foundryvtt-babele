import {
    collectPaginatedGitLab,
    getProjectId,
    getReleaseTag,
    gitlabApiRequest,
} from "./release-lib.mjs";

const tag = getReleaseTag();
const projectId = getProjectId();
const milestones = await collectPaginatedGitLab(`/projects/${encodeURIComponent(projectId)}/milestones`, {
    title: tag,
});

const milestone = milestones.find((item) => item.title === tag);

if (!milestone) {
    throw new Error(`Could not find milestone '${tag}' to close`);
}

if (milestone.state === "closed") {
    console.log(`Babele | milestone '${tag}' is already closed`);
    process.exit(0);
}

await gitlabApiRequest(`/projects/${encodeURIComponent(projectId)}/milestones/${milestone.id}`, {
    method: "PUT",
    body: {
        state_event: "close",
    },
});

console.log(`Babele | closed milestone '${tag}'`);
