import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

test("prepare-release-manifest pins manifest and download URLs to the tagged artifact", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "babele-release-manifest-"));
  const manifestPath = path.join(tempDir, "module.json");

  await writeFile(manifestPath, JSON.stringify({
    id: "babele",
    version: "0.0.0",
    manifest: "https://gitlab.com/riccisi/foundryvtt-babele/raw/master/module/module.json",
    download: "https://gitlab.com/riccisi/foundryvtt-babele/-/jobs/artifacts/0.0.0/raw/babele.zip?job=build",
  }, null, 2));

  await execFileAsync("node", ["scripts/prepare-release-manifest.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BABELE_MANIFEST_PATH: manifestPath,
      RELEASE_TAG: "2.7.8",
      CI_COMMIT_TAG: "",
      RELEASE_PROJECT_URL: "https://gitlab.com/riccisi/foundryvtt-babele",
      RELEASE_JOB_NAME: "build",
      CI_JOB_NAME: "",
    },
  });

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.equal(manifest.version, "2.7.8");
  assert.equal(
    manifest.manifest,
    "https://gitlab.com/riccisi/foundryvtt-babele/-/jobs/artifacts/2.7.8/raw/module/module.json?job=build",
  );
  assert.equal(
    manifest.download,
    "https://gitlab.com/riccisi/foundryvtt-babele/-/jobs/artifacts/2.7.8/raw/babele.zip?job=build",
  );
});
