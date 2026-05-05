import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {applyRuntimeTranslationsToFoundry} = await import("../module/script/foundry/babele-runtime-applier.js");

test("applyRuntimeTranslationsToFoundry rebuilds the Foundry document index after translating pack indexes", async () => {
  let indexCalls = 0;
  let initializeTreeCalls = 0;
  let clearCalls = 0;

  game.documentIndex = {
    trees: {
      Item: {stale: true},
    },
    uuids: {
      "Compendium.module-one.items.Item.item-1": [{}],
    },
    ready: Promise.resolve(),
    async index() {
      indexCalls += 1;
      assert.deepEqual(this.trees, {});
      assert.deepEqual(this.uuids, {});
      this.trees.Item = {rebuilt: true};
      this.uuids["Compendium.module-one.items.Item.item-1"] = [];
    },
  };

  game.packs = new foundry.utils.Collection([[
    "module-one.items",
    {
      collection: "module-one.items",
      metadata: {id: "module-one.items", label: "Items"},
      index: [{_id: "item-1", name: "Sword"}],
      folders: new foundry.utils.Collection(),
      initializeTree() {
        initializeTreeCalls += 1;
      },
      clear() {
        clearCalls += 1;
      },
    },
  ]]);
  game.collections.set("Folder", []);

  const translatedPack = {
    metadata: {label: "Oggetti"},
    translateIndex(index) {
      index.forEach((entry) => {
        entry.originalName = entry.name;
        entry.name = "Spada";
        entry.translated = true;
        entry.hasTranslation = true;
      });
      return index;
    },
  };

  await applyRuntimeTranslationsToFoundry({
    sources: {
      async shareTranslationFiles() {},
      async shareGlobalMappingFiles() {},
    },
    session: {
      mappedCompendiums: new foundry.utils.Collection([["module-one.items", translatedPack]]),
      folderTranslations: {
        translatePackFolders() {},
        translateSystemPackFolders() {},
        translateImportedCompendiumFolders() {},
      },
    },
  });

  assert.equal(game.packs.get("module-one.items").index[0].name, "Spada");
  assert.equal(indexCalls, 1);
  assert.equal(initializeTreeCalls, 1);
  assert.equal(clearCalls, 1);
});
