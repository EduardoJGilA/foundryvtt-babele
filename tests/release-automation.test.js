import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFoundryReleasePayload,
  buildGitLabReleasePayload,
  formatReleaseNotes,
} from "../scripts/release-lib.mjs";

test("formatReleaseNotes groups milestone issues by type label", () => {
  const notes = formatReleaseNotes({
    tag: "2.7.8",
    milestoneTitle: "2.7.8",
    generatedAt: "2026-04-09",
    issues: [
      {
        iid: 126,
        title: "Spellbook compatibility",
        labels: ["type::bug"],
        references: {short: "#126"},
        web_url: "https://gitlab.com/example/issues/126",
      },
      {
        iid: 150,
        title: "Automate releases",
        labels: ["type::feature"],
        references: {short: "#150"},
        web_url: "https://gitlab.com/example/issues/150",
      },
      {
        iid: 151,
        title: "Internal cleanup",
        labels: ["type::refactor"],
        references: {short: "#151"},
        web_url: "https://gitlab.com/example/issues/151",
      },
    ],
  });

  assert.match(notes, /# Babele 2\.7\.8/);
  assert.match(notes, /## Fixed/);
  assert.match(notes, /#126 Spellbook compatibility/);
  assert.match(notes, /## Added/);
  assert.match(notes, /#150 Automate releases/);
  assert.match(notes, /## Changed/);
  assert.match(notes, /#151 Internal cleanup/);
});

test("buildGitLabReleasePayload includes milestone and artifact links", () => {
  const payload = buildGitLabReleasePayload({
    tag: "2.7.8",
    notes: "Release notes",
    manifest: {
      manifest: "https://gitlab.com/example/-/jobs/artifacts/2.7.8/raw/module/module.json?job=build",
      download: "https://gitlab.com/example/-/jobs/artifacts/2.7.8/raw/babele.zip?job=build",
    },
  });

  assert.equal(payload.name, "Babele 2.7.8");
  assert.deepEqual(payload.milestones, ["2.7.8"]);
  assert.equal(payload.assets.links[0].name, "Manifest");
  assert.equal(payload.assets.links[1].name, "Package");
});

test("buildFoundryReleasePayload mirrors manifest compatibility and notes URL", () => {
  const payload = buildFoundryReleasePayload({
    manifest: {
      id: "babele",
      version: "2.7.8",
      manifest: "https://gitlab.com/example/-/jobs/artifacts/2.7.8/raw/module/module.json?job=build",
      compatibility: {
        minimum: 13,
        verified: "13.351",
      },
    },
    notesUrl: "https://gitlab.com/example/-/releases/2.7.8",
    dryRun: true,
  });

  assert.equal(payload.id, "babele");
  assert.equal(payload["dry-run"], true);
  assert.equal(payload.release.version, "2.7.8");
  assert.equal(payload.release.notes, "https://gitlab.com/example/-/releases/2.7.8");
  assert.deepEqual(payload.release.compatibility, {
    minimum: 13,
    verified: "13.351",
  });
});
