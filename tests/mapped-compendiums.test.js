import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {default: Babel} = await import("../module/script/babele.js");
const {MappedCompendium} = await import("../module/script/compendium/mapped-compendium.js");
const {MappedCompendiums} = await import("../module/script/compendium/mapped-compendiums.js");
const {PackFolderTranslationRegistry} = await import("../module/script/translation/pack-folder-translation-registry.js");
const {CompendiumCatalog} = await import("../module/script/compendium/compendium-catalog.js");

test("MappedCompendiums loads only supported compendium packs", async () => {
  const babele = new Babel();
  const catalog = new CompendiumCatalog();

  game.data.packs = [
    {
      type: "Item",
      packageName: "test",
      packageType: "module",
      name: "items",
      label: "Items",
    },
    {
      type: "ChatMessage",
      packageName: "test",
      packageType: "module",
      name: "chat",
      label: "Chat",
    },
  ];
  const translationsByCollection = {
    "test.items": {
      entries: {
        "item-1": {
          name: "Spada",
        },
      },
    },
    "test._packs-folders": {
      entries: {
        Bestiary: "Bestiario",
      },
      folders: {
        Rules: "Regole",
      },
    },
  };

  const translations = {
    for(collection) {
      return translationsByCollection[collection] ?? null;
    },
    values() {
      return Object.entries(translationsByCollection).map(([collection, payload]) => ({
        collection,
        ...payload,
      }));
    },
  };

  const mappedCompendiums = await new MappedCompendiums({
    catalog,
    documentMappings: babele.documentMappings,
    translations,
    translationStrategies: babele.translationMatchStrategies(),
  }).load();

  assert.equal(mappedCompendiums.get("test.items") instanceof MappedCompendium, true);
  assert.equal(mappedCompendiums.get("test.items").translated, true);
  assert.equal(mappedCompendiums.get("test.chat"), null);
  assert.equal(mappedCompendiums.get("test._packs-folders"), null);
});

test("PackFolderTranslationRegistry loads synthetic _packs-folders payloads separately from compendiums", async () => {
  const translations = {
    values() {
      return [{
        collection: "test._packs-folders",
        entries: {
          Bestiary: "Bestiario",
        },
      }];
    },
  };

  const registry = await new PackFolderTranslationRegistry({translations}).load();

  assert.deepEqual(registry.get("test._packs-folders")?.translations(), {
    Bestiary: "Bestiario",
  });
});
