import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

const {TestCollection} = installFoundryStubs();

const {CompendiumRuntime} = await import("../module/script/compendium/compendium-runtime.js");

test("CompendiumRuntime resolves local compendiums before global ones", () => {
  const globalPack = {id: "global"};
  const localPack = {id: "local"};
  const runtime = new CompendiumRuntime({
    globalPacks: new TestCollection([["test.items", globalPack]]),
    localPacks: new TestCollection([["test.items", localPack]]),
  });

  assert.equal(runtime.mappedCompendiumFor("test.items"), localPack);
});

test("CompendiumRuntime child preserves parent local compendiums while layering new ones", () => {
  const parentLocal = {id: "parent-local"};
  const childLocal = {id: "child-local"};
  const runtime = new CompendiumRuntime({
    globalPacks: new TestCollection(),
    localPacks: new TestCollection([["parent.items", parentLocal]]),
  });

  const child = runtime.child(new TestCollection([["child.items", childLocal]]));

  assert.equal(child.mappedCompendiumFor("parent.items"), parentLocal);
  assert.equal(child.mappedCompendiumFor("child.items"), childLocal);
});

test("CompendiumRuntime resolves local compendiums by document type using only local overlays", () => {
  const localItemPack = {metadata: {type: "Item"}};
  const globalItemPack = {metadata: {type: "Item"}};
  const runtime = new CompendiumRuntime({
    globalPacks: new TestCollection([["global.items", globalItemPack]]),
    localPacks: new TestCollection([["local.items", localItemPack]]),
  });

  assert.equal(runtime.localMappedCompendiumFor("Item"), localItemPack);
  assert.equal(runtime.localMappedCompendiumFor("Actor"), null);
});

test("CompendiumRuntime child inherits and can override the current compendium", () => {
  const parentCompendium = {metadata: {id: "parent"}};
  const childCompendium = {metadata: {id: "child"}};
  const runtime = new CompendiumRuntime({
    currentCompendium: parentCompendium,
  });

  const inherited = runtime.child();
  const overridden = runtime.child({currentCompendium: childCompendium});

  assert.equal(inherited.currentCompendium(), parentCompendium);
  assert.equal(overridden.currentCompendium(), childCompendium);
});

test("CompendiumRuntime local document-type lookups prefer the innermost child scope", () => {
  const parentItemPack = {metadata: {id: "parent.items", type: "Item"}};
  const childItemPack = {metadata: {id: "child.items", type: "Item"}};
  const runtime = new CompendiumRuntime({
    localPacks: new TestCollection([["parent.items", parentItemPack]]),
  });

  const child = runtime.child({
    localPacks: new TestCollection([["child.items", childItemPack]]),
  });

  assert.equal(child.localMappedCompendiumFor("Item"), childItemPack);
});

test("CompendiumRuntime translated pack lookups prefer the innermost child scope", () => {
  const data = {_id: "shared-id", name: "Shared"};
  const parentItemPack = {
    translated: true,
    metadata: {id: "parent.items", type: "Item"},
    hasTranslation(document, documentType) {
      return documentType === "Item" && document._id === "shared-id";
    },
  };
  const childItemPack = {
    translated: true,
    metadata: {id: "child.items", type: "Item"},
    hasTranslation(document, documentType) {
      return documentType === "Item" && document._id === "shared-id";
    },
  };
  const runtime = new CompendiumRuntime({
    localPacks: new TestCollection([["parent.items", parentItemPack]]),
  });

  const child = runtime.child({
    localPacks: new TestCollection([["child.items", childItemPack]]),
  });

  assert.equal(child.translatedPackFor("Item", data), childItemPack);
});

test("CompendiumRuntime.from does not read implicit global state from game.babele", () => {
  game.babele = {
    mappedCompendiums: new TestCollection([["test.items", {id: "legacy-global-pack"}]]),
  };

  const runtime = CompendiumRuntime.from({});

  assert.equal(runtime.mappedCompendiumFor("test.items"), null);
});
