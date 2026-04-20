import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {ExportKeys} = await import("../module/script/identity/export-key-allocator.js");

test("ExportKeys consumes document-mapping export candidates before falling back", () => {
  const keys = new ExportKeys();
  const mapping = {
    exportKeyCandidates(document) {
      return [`${document.range[0]}-${document.range[1]}`, document._id];
    },
  };

  assert.equal(
    keys.keyFor({_id: "result-1", range: [2, 3]}, "result", mapping),
    "2-3",
  );
});

test("ExportKeys still falls back to synthetic keys when all candidates collide", () => {
  const keys = new ExportKeys(new Set(["2-3", "result-1"]));
  const mapping = {
    exportKeyCandidates(document) {
      return [`${document.range[0]}-${document.range[1]}`, document._id];
    },
  };

  assert.equal(
    keys.keyFor({_id: "result-1", range: [2, 3]}, "result", mapping),
    "result-2",
  );
});
