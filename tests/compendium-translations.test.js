import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {TranslationRegistry} = await import("../module/script/translation/translation-registry.js");
const {CompendiumTranslations} = await import("../module/script/translation/compendium-translations.js");
test("TranslationRegistry.loadTranslations merges multiple sources per collection and includes _packs-folders payloads", async () => {
  game.data.packs = [
    {type: "Item", packageName: "test", packageType: "module", name: "items"},
  ];

  const sources = new TranslationRegistry();
  sources.translationSources = async () => [
    {file: "modules/a/test.items.json", baseName: "test.items.json"},
    {file: "modules/b/test.items.json", baseName: "test.items.json"},
    {file: "modules/a/test._packs-folders.json", baseName: "test._packs-folders.json"},
  ];
  sources.loadJsonFile = async (file) => {
    if (file === "modules/a/test.items.json") {
      return {
        label: "Items A",
        entries: {
          sword: {name: "Sword"},
        },
        mapping: {
          description: "system.description.value",
        },
      };
    }

    if (file === "modules/b/test.items.json") {
      return {
        label: "Items B",
        entries: {
          shield: {name: "Shield"},
        },
        folders: {
          Equipment: "Equipaggiamento",
        },
      };
    }

    if (file === "modules/a/test._packs-folders.json") {
      return {
        entries: {
          Rules: "Regole",
        },
      };
    }

    throw new Error(`Unexpected file ${file}`);
  };

  const translations = await sources.loadTranslations("en");

  const items = translations.for("test.items");
  const packFolders = translations.for("test._packs-folders");

  assert.equal(translations.size, 2);
  assert.equal(items.label, "Items B");
  assert.deepEqual(items.entries, {
    sword: {name: "Sword"},
    shield: {name: "Shield"},
  });
  assert.deepEqual(items.mapping, {
    description: "system.description.value",
  });
  assert.deepEqual(items.folders, {
    Equipment: "Equipaggiamento",
  });
  assert.deepEqual(packFolders.entries, {
    Rules: "Regole",
  });
});

test("CompendiumTranslations indexes loaded payloads by collection", () => {
  const translations = new CompendiumTranslations({
    translations: [
      {collection: "test.items", entries: {sword: {name: "Sword"}}},
      {collection: "test.actors", entries: {mage: {name: "Mage"}}},
    ],
  });

  assert.equal(translations.size, 2);
  assert.deepEqual(translations.for("test.items")?.entries, {
    sword: {name: "Sword"},
  });
  assert.equal(translations.has("test.actors"), true);
  assert.equal(translations.empty(), false);
});
