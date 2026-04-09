import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";

const DEFAULT_PROJECT_URL = "https://gitlab.com/riccisi/foundryvtt-babele";
const manifestPath = path.resolve(process.env.BABELE_MANIFEST_PATH ?? "module/module.json");
const releaseTag = process.env.RELEASE_TAG ?? process.env.CI_COMMIT_TAG;
const projectUrl = process.env.CI_PROJECT_URL ?? process.env.RELEASE_PROJECT_URL ?? DEFAULT_PROJECT_URL;
const jobName = process.env.RELEASE_JOB_NAME ?? process.env.CI_JOB_NAME ?? "build";

if (!releaseTag) {
    console.error("Babele | prepare-release-manifest requires CI_COMMIT_TAG or RELEASE_TAG");
    process.exit(1);
}

const manifestUrl = `${projectUrl}/-/jobs/artifacts/${encodeURIComponent(releaseTag)}/raw/module/module.json?job=${encodeURIComponent(jobName)}`;
const downloadUrl = `${projectUrl}/-/jobs/artifacts/${encodeURIComponent(releaseTag)}/raw/babele.zip?job=${encodeURIComponent(jobName)}`;

const rawManifest = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(rawManifest);

manifest.version = releaseTag;
manifest.manifest = manifestUrl;
manifest.download = downloadUrl;

await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);

console.log(`Babele | prepared release manifest for ${releaseTag}`, {
    manifest: manifestUrl,
    download: downloadUrl,
    manifestPath,
});
