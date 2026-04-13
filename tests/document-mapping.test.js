import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {DocumentMapping} = await import("../module/script/document-mapping.js");
const {CompendiumMapping} = await import("../module/script/compendium-mapping.js");

test("DocumentMapping is the canonical class behind CompendiumMapping compatibility exports", () => {
  const mapping = new DocumentMapping("Item", null, null);

  assert.equal(mapping instanceof DocumentMapping, true);
  assert.equal(mapping instanceof CompendiumMapping, true);
  assert.equal(mapping.isDynamic(), false);
});
