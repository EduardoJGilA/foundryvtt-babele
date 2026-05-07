import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {default: Babel} = await import("../module/script/babele.js");
const {MappedCompendium} = await import("../module/script/compendium/mapped-compendium.js");
const {MappedCompendiums} = await import("../module/script/compendium/mapped-compendiums.js");
const {PackFolderTranslationsCatalog} = await import("../module/script/translation/pack-folder-translations-catalog.js");

test("MappedCompendiums loads only supported compendium packs", async () => {
  const babele = new Babel();

  game.data.packs = [
    {
      type: "Item",
      packageName: "test",
      packageType: "module",
      name: "items",
      label: "Items",
    },
    {
      type: "ActiveEffect",
      packageName: "test",
      packageType: "module",
      name: "effects",
      label: "Effects",
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
    "test.effects": {
      entries: {
        "effect-1": {
          name: "Benedetto",
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
    documentMappings: babele.documentMappings,
    translations,
    translationStrategies: babele.translationMatchStrategies(),
  }).load();

  assert.equal(mappedCompendiums.get("test.items") instanceof MappedCompendium, true);
  assert.equal(mappedCompendiums.get("test.items").translated, true);
  assert.equal(mappedCompendiums.get("test.effects") instanceof MappedCompendium, true);
  assert.equal(mappedCompendiums.get("test.effects").translated, true);
  assert.equal(mappedCompendiums.get("test.chat"), null);
  assert.equal(mappedCompendiums.get("test._packs-folders"), null);
});

test("MappedCompendiums gives translated root packs an implicit runtime for embedded fallback translation", async () => {
  const babele = new Babel();

  game.data.packs = [
    {
      type: "Actor",
      packageName: "test",
      packageType: "module",
      name: "actors",
      label: "Actors",
    },
    {
      type: "Item",
      packageName: "test",
      packageType: "module",
      name: "items",
      label: "Items",
    },
  ];

  const translationsByCollection = {
    "test.actors": {
      entries: {
        "actor-1": {
          name: "Attore Tradotto",
        },
      },
    },
    "test.items": {
      mapping: {
        description: "system.description.value",
      },
      entries: {
        "Original Sword": {
          name: "Spada Tradotta",
          description: "Descrizione tradotta",
        },
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
    documentMappings: babele.documentMappings,
    translations,
    translationStrategies: babele.translationMatchStrategies(),
  }).load();
  mappedCompendiums.get("test.items").index = new foundry.utils.Collection([[
    "source-sword",
    {
      _id: "source-sword",
      name: "Original Sword",
    },
  ]]);

  const translated = mappedCompendiums.translate("test.actors", {
    _id: "actor-1",
    name: "Original Actor",
    items: [
      {
        _id: "item-1",
        name: "Runtime Sword",
        _stats: {
          compendiumSource: "Compendium.test.items.Item.source-sword",
        },
        system: {
          description: {
            value: "Original description",
          },
        },
      },
    ],
  });

  assert.equal(translated.name, "Attore Tradotto");
  assert.equal(translated.items[0].name, "Spada Tradotta");
  assert.equal(translated.items[0].system.description.value, "Descrizione tradotta");
});

test("PackFolderTranslationsCatalog loads synthetic _packs-folders payloads separately from compendiums", async () => {
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

  const registry = await new PackFolderTranslationsCatalog({translations}).load();

  assert.deepEqual(registry.get("test._packs-folders"), {
    collection: "test._packs-folders",
    entries: {
      Bestiary: "Bestiario",
    },
  });
  assert.deepEqual(registry.allTranslations(), {
    Bestiary: "Bestiario",
  });
});
