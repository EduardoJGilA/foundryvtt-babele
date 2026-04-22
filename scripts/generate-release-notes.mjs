import {mkdir, readFile} from "node:fs/promises";
import {
    collectPaginatedGitLab,
    fileExists,
    formatReleaseNotes,
    getProjectId,
    getReleaseContextPath,
    getReleaseNotesOverridePath,
    getReleaseNotesPath,
    getReleaseOutputDir,
    getReleaseTag,
    writeJson,
    writeText,
} from "./release-lib.mjs";

const tag = getReleaseTag();
const outputDir = getReleaseOutputDir();
const notesPath = getReleaseNotesPath();
const contextPath = getReleaseContextPath();
const overridePath = getReleaseNotesOverridePath(tag);

await mkdir(outputDir, {recursive: true});

let notes;
let context;

if (await fileExists(overridePath)) {
    notes = await readFile(overridePath, "utf8");
    context = {
        milestone: tag,
        tag,
        source: "override",
        overridePath,
        issueCount: null,
        generatedAt: new Date().toISOString(),
    };
} else {
    const issues = await collectPaginatedGitLab(`/projects/${encodeURIComponent(getProjectId())}/issues`, {
        milestone: tag,
        state: "closed",
        scope: "all",
    });
    notes = formatReleaseNotes({
        tag,
        milestoneTitle: tag,
        issues,
        generatedAt: new Date().toISOString().slice(0, 10),
    });
    context = {
        milestone: tag,
        tag,
        source: "milestone",
        issueCount: issues.length,
        issueIids: issues.map((issue) => issue.iid),
        generatedAt: new Date().toISOString(),
    };
}

await writeText(notesPath, notes);
await writeJson(contextPath, context);

console.log(`Babele | generated release notes for ${tag}`, {
    notesPath,
    contextPath,
    source: context.source,
});
