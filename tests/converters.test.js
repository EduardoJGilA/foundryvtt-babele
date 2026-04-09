import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

const {TestCollection} = installFoundryStubs();

const {Converters} = await import("../module/script/converters.js");
const {TranslatedCompendium} = await import("../module/script/translated-compendium.js");

test("fromPack.extract exports embedded documents keyed by name with id fallback", () => {
  const converter = Converters.fromPack(null, "Item");

  const items = [
    {
      _id: "item-1",
      name: "Torch",
      system: {
        description: {
          value: "A simple torch",
        },
      },
    },
    {
      _id: "item-2",
      name: "Torch",
      system: {
        description: {
          value: "A second torch",
        },
      },
    },
  ];

  const extracted = converter.extract(items, {name: "Actor"}, {
    metadata: {type: "Actor"},
  }, {
    options: {},
  });

  assert.deepEqual(extracted, {
    Torch: {
      name: "Torch",
      description: "A simple torch",
    },
    "item-2": {
      name: "Torch",
      description: "A second torch",
    },
  });
});

test("adventure embedded extraction uses entry-specific translated compendium context", () => {
  const converter = Converters.fromDefaultMapping("Item", "items");
  const packs = new TestCollection();

  const parentTc = new TranslatedCompendium({
    id: "test.adventure",
    name: "adventure",
    type: "Adventure",
    packageName: "test",
    packageType: "module",
  }, {
    mapping: {
      items: {
        description: "system.description.value",
      },
    },
    entries: {
      adventureA: {
        items: {
          "item-a": {
            name: "Translated A",
            description: "Description A",
          },
        },
      },
      adventureB: {
        items: {
          "item-b": {
            name: "Translated B",
            description: "Description B",
          },
        },
      },
    },
  });

  const contextA = new TranslatedCompendium({
    id: "test.adventure::adventureA::items",
    name: "test.adventure::adventureA::items",
    type: "Item",
    virtual: true,
    adventureCollection: "test.adventure",
    adventureEntryKey: "adventureA",
  }, {
    mapping: {
      description: "system.description.value",
    },
    entries: {
      "item-a": {
        name: "Translated A",
        description: "Description A",
      },
    },
  });

  const contextB = new TranslatedCompendium({
    id: "test.adventure::adventureB::items",
    name: "test.adventure::adventureB::items",
    type: "Item",
    virtual: true,
    adventureCollection: "test.adventure",
    adventureEntryKey: "adventureB",
  }, {
    mapping: {
      description: "system.description.value",
    },
    entries: {
      "item-b": {
        name: "Translated B",
        description: "Description B",
      },
    },
  });

  packs.set("test.adventure", parentTc);
  packs.set("test.adventure::adventureA::items", contextA);
  packs.set("test.adventure::adventureB::items", contextB);
  game.babele.packs = packs;
  game.babele.getAdventureEntryTranslatedCompendium = (_metadata, data, mappingKey) => {
    assert.equal(mappingKey, "items");
    return packs.get(`test.adventure::${data._id}::items`) ?? null;
  };

  const adventureA = {
    _id: "adventureA",
    name: "Adventure A",
    items: [
      {
        _id: "item-a",
        name: "Original A",
        system: {
          description: {
            value: "Original description A",
          },
        },
      },
    ],
  };

  const adventureB = {
    _id: "adventureB",
    name: "Adventure B",
    items: [
      {
        _id: "item-b",
        name: "Original B",
        system: {
          description: {
            value: "Original description B",
          },
        },
      },
    ],
  };

  const extractedA = converter.extract(adventureA.items, adventureA, parentTc, {options: {}});
  const extractedB = converter.extract(adventureB.items, adventureB, parentTc, {options: {}});

  assert.deepEqual(extractedA, {
    "Original A": {
      name: "Original A",
      description: "Original description A",
    },
  });
  assert.deepEqual(extractedB, {
    "Original B": {
      name: "Original B",
      description: "Original description B",
    },
  });
});
