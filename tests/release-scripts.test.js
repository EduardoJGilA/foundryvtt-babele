import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);
const mockFetchLoader = path.resolve("tests/helpers/mock-fetch-loader.mjs");

async function createMockFetchFiles(routes) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "babele-mock-fetch-"));
  const routesPath = path.join(tempDir, "routes.json");
  const requestsPath = path.join(tempDir, "requests.json");

  await writeFile(routesPath, JSON.stringify(routes, null, 2));
  await writeFile(requestsPath, "[]");

  return {tempDir, routesPath, requestsPath};
}

async function runScriptWithMockedFetch(scriptPath, {env, routes}) {
  const files = await createMockFetchFiles(routes);

  try {
    await execFileAsync("node", ["--import", mockFetchLoader, scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
        MOCK_FETCH_ROUTES_FILE: files.routesPath,
        MOCK_FETCH_REQUESTS_FILE: files.requestsPath,
      },
    });

    return JSON.parse(await readFile(files.requestsPath, "utf8"));
  } finally {
    // Temporary files are left under the OS temp dir on purpose.
  }
}

async function createReleaseFixture() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "babele-release-scripts-"));
  const releaseDir = path.join(tempDir, ".release");
  const manifestPath = path.join(tempDir, "module.json");
  const notesPath = path.join(releaseDir, "release-notes.md");

  await mkdir(releaseDir, {recursive: true});
  await writeFile(manifestPath, JSON.stringify({
    id: "babele",
    version: "2.7.8",
    compatibility: {
      minimum: 13,
      verified: "14",
    },
    manifest: "https://gitlab.example.com/babele/-/jobs/artifacts/2.7.8/raw/module/module.json?job=build",
    download: "https://gitlab.example.com/babele/-/jobs/artifacts/2.7.8/raw/babele.zip?job=build",
  }, null, 2));
  await writeFile(notesPath, "# Babele 2.7.8\n\nGenerated notes.\n");

  return {tempDir, releaseDir, manifestPath, notesPath};
}

test("generate-release-notes builds notes and context from milestone issues", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "babele-release-notes-"));
  const requests = await runScriptWithMockedFetch("scripts/generate-release-notes.mjs", {
    env: {
      CI_COMMIT_TAG: "2.7.8",
      CI_PROJECT_ID: "16173589",
      CI_API_V4_URL: "https://gitlab.example.com/api/v4",
      GITLAB_API_TOKEN: "test-token",
      RELEASE_OUTPUT_DIR: path.join(tempDir, ".release"),
    },
    routes: [
      {
        method: "GET",
        match: "exact",
        url: "https://gitlab.example.com/api/v4/projects/16173589/issues?milestone=2.7.8&state=closed&scope=all&per_page=100&page=1",
        headers: {"x-next-page": ""},
        body: [
          {
            iid: 120,
            title: "Adventure embedded translation bug",
            labels: ["type::bug"],
            references: {short: "#120"},
            web_url: "https://gitlab.example.com/issues/120",
          },
          {
            iid: 150,
            title: "Automate releases",
            labels: ["type::feature"],
            references: {short: "#150"},
            web_url: "https://gitlab.example.com/issues/150",
          },
        ],
      },
    ],
  });

  const notes = await readFile(path.join(tempDir, ".release", "release-notes.md"), "utf8");
  const context = JSON.parse(await readFile(path.join(tempDir, ".release", "release-context.json"), "utf8"));

  assert.match(notes, /# Babele 2\.7\.8/);
  assert.match(notes, /#120 Adventure embedded translation bug/);
  assert.match(notes, /#150 Automate releases/);
  assert.equal(context.source, "milestone");
  assert.deepEqual(context.issueIids, [120, 150]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers["PRIVATE-TOKEN"], "test-token");
});

test("publish-gitlab-release creates the release when it does not exist", async () => {
  const fixture = await createReleaseFixture();
  const requests = await runScriptWithMockedFetch("scripts/publish-gitlab-release.mjs", {
    env: {
      CI_COMMIT_TAG: "2.7.8",
      CI_PROJECT_ID: "16173589",
      CI_PROJECT_URL: "https://gitlab.example.com/babele",
      CI_API_V4_URL: "https://gitlab.example.com/api/v4",
      GITLAB_API_TOKEN: "test-token",
      BABELE_MANIFEST_PATH: fixture.manifestPath,
      RELEASE_OUTPUT_DIR: fixture.releaseDir,
    },
    routes: [
      {
        method: "GET",
        match: "exact",
        url: "https://gitlab.example.com/api/v4/projects/16173589/releases/2.7.8",
        status: 404,
        body: {message: "404 Release Not Found"},
      },
      {
        method: "POST",
        match: "exact",
        url: "https://gitlab.example.com/api/v4/projects/16173589/releases",
        body: {tag_name: "2.7.8"},
      },
    ],
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers["PRIVATE-TOKEN"], "test-token");
  assert.equal(requests[1].body.tag_name, "2.7.8");
  assert.equal(requests[1].body.milestones[0], "2.7.8");
  assert.equal(requests[1].body.assets.links[0].name, "Manifest");
});

test("publish-foundry-release sends the expected payload and authorization token", async () => {
  const fixture = await createReleaseFixture();
  const requests = await runScriptWithMockedFetch("scripts/publish-foundry-release.mjs", {
    env: {
      CI_COMMIT_TAG: "2.7.8",
      CI_PROJECT_URL: "https://gitlab.example.com/babele",
      FOUNDRY_RELEASE_TOKEN: "fvttp_secret",
      FOUNDRY_DRY_RUN: "true",
      FOUNDRY_RELEASE_API_URL: "https://foundryvtt.example.com/_api/packages/release_version/",
      BABELE_MANIFEST_PATH: fixture.manifestPath,
    },
    routes: [
      {
        method: "POST",
        match: "exact",
        url: "https://foundryvtt.example.com/_api/packages/release_version/",
        body: {status: "success"},
      },
    ],
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.Authorization, "fvttp_secret");
  assert.equal(requests[0].body.id, "babele");
  assert.equal(requests[0].body["dry-run"], true);
  assert.equal(requests[0].body.release.version, "2.7.8");
});

test("close-gitlab-milestone closes the matching milestone", async () => {
  const requests = await runScriptWithMockedFetch("scripts/close-gitlab-milestone.mjs", {
    env: {
      CI_COMMIT_TAG: "2.7.8",
      CI_PROJECT_ID: "16173589",
      CI_API_V4_URL: "https://gitlab.example.com/api/v4",
      GITLAB_API_TOKEN: "test-token",
    },
    routes: [
      {
        method: "GET",
        match: "exact",
        url: "https://gitlab.example.com/api/v4/projects/16173589/milestones?title=2.7.8&per_page=100&page=1",
        headers: {"x-next-page": ""},
        body: [
          {
            id: 42,
            title: "2.7.8",
            state: "active",
          },
        ],
      },
      {
        method: "PUT",
        match: "exact",
        url: "https://gitlab.example.com/api/v4/projects/16173589/milestones/42",
        body: {id: 42, state: "closed"},
      },
    ],
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.state_event, "close");
});
