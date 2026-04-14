import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

const {TestCollection} = installFoundryStubs();

const {Converters} = await import("../module/script/converters.js");
const {CompendiumRuntime} = await import("../module/script/compendium-runtime.js");
const {createMappedCompendium} = await import("../module/script/mapped-compendium-decorator.js");

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

  const parentTc = createMappedCompendium({
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
  game.babele.packs = new TestCollection([["test.adventure", parentTc]]);

  const contextA = createMappedCompendium({
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

  const contextB = createMappedCompendium({
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

  const extractedA = converter.extract(adventureA.items, adventureA, parentTc, {
    runtime: new CompendiumRuntime({
      globalPacks: game.babele.packs,
      localPacks: new TestCollection([["test.adventure::adventureA::items", contextA]]),
    }),
  });
  const extractedB = converter.extract(adventureB.items, adventureB, parentTc, {
    runtime: new CompendiumRuntime({
      globalPacks: game.babele.packs,
      localPacks: new TestCollection([["test.adventure::adventureB::items", contextB]]),
    }),
  });

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

test("fromPack uses TranslationResolver fallback order for sourceId-based matches", () => {
  const items = [
    {
      _id: "item-1",
      name: "Original Sword",
      flags: {
        core: {
          sourceId: "Compendium.test.items.shared-source",
        },
      },
      system: {
        description: {
          value: "Original description",
        },
      },
    },
  ];

  const translated = Converters._fromPack(
    items,
    createMappedCompendium({
      type: "Item",
    }, {
      mapping: {
        description: "system.description.value",
      },
      entries: {
        "shared-source": {
          name: "Translated Sword",
          description: "Translated description",
        },
      },
    }),
  );

  assert.equal(translated[0].name, "Translated Sword");
  assert.equal(translated[0].system.description.value, "Translated description");
  assert.equal(translated[0].translated, true);
});

test("pages converter uses TranslationResolver fallback order", () => {
  const pages = [
    {
      _id: "page-1",
      name: "Original Page",
      _stats: {
        compendiumSource: "Compendium.test.journal.page-source",
      },
      image: {
        caption: "Original caption",
      },
      src: "original.png",
      text: {
        content: "<p>Original</p>",
      },
      video: {
        width: 640,
        height: 480,
      },
    },
  ];

  const translated = Converters.pages()(pages, {
    "page-source": {
      name: "Translated Page",
      caption: "Translated caption",
      src: "translated.png",
      text: "<p>Translated</p>",
      width: 800,
      height: 600,
    },
  });

  assert.equal(translated[0].name, "Translated Page");
  assert.equal(translated[0].image.caption, "Translated caption");
  assert.equal(translated[0].src, "translated.png");
  assert.equal(translated[0].text.content, "<p>Translated</p>");
  assert.equal(translated[0].video.width, 800);
  assert.equal(translated[0].video.height, 600);
});

test("fromPack fallback only uses translated packs with the same document type", () => {
  const item = {
    _id: "shared-id",
    name: "Shared Name",
    system: {
      description: {
        value: "Original description",
      },
    },
  };

  const actorPack = {
    translated: true,
    metadata: {
      type: "Actor",
      virtual: false,
    },
    hasTranslation(data, documentType) {
      return documentType === this.metadata.type && data._id === "shared-id";
    },
    translate() {
      return {
        name: "Wrong Actor Translation",
        translated: true,
      };
    },
  };

  const itemPack = {
    translated: true,
    metadata: {
      type: "Item",
      virtual: false,
    },
    hasTranslation(data, documentType) {
      return documentType === this.metadata.type && data._id === "shared-id";
    },
    translate(data) {
      return {
        ...data,
        name: "Correct Item Translation",
        translated: true,
      };
    },
  };

  game.babele.packs = [actorPack, itemPack];

  const translated = Converters._fromPack(
    [item],
    createMappedCompendium({type: "Item"}, null),
  );

  assert.equal(translated[0].name, "Correct Item Translation");
});

test("adventure actors translate tokenName through the embedded actor context", () => {
  game.babele.converters = {
    ...game.babele.converters,
    name: Converters.mappedField("name"),
    fromPack: Converters.fromPack(),
  };
  const converter = Converters.fromDefaultMapping("Actor", "actors");
  const adventure = createMappedCompendium({
    id: "test.adventure",
    name: "adventure",
    type: "Adventure",
    packageName: "test",
    packageType: "module",
  }, {
    entries: {
      adventureA: {
        actors: {
          "actor-a": {
            name: "Goblin IT",
          },
        },
      },
    },
  });
  const adventureData = {
    _id: "adventureA",
    name: "Adventure A",
  };
  const translated = converter(
    [
      {
        _id: "actor-a",
        name: "Goblin",
        prototypeToken: {
          name: "Goblin",
        },
        system: {
          details: {
            biography: {
              value: "Original biography",
            },
          },
        },
        items: [],
      },
    ],
    adventure.translationsFor(adventureData).actors,
    adventureData,
    adventure,
    null,
    new CompendiumRuntime({
      globalPacks: new TestCollection([["test.adventure", adventure]]),
    }),
  );

  assert.equal(translated[0].name, "Goblin IT");
  assert.equal(translated[0].prototypeToken.name, "Goblin IT");
});

test("fromPack fallback re-branches runtime to the translated root compendium", () => {
  game.babele.converters = {
    ...game.babele.converters,
    name: Converters.mappedField("name"),
    fromPack: Converters.fromPack(),
  };

  const contextPack = createMappedCompendium({
    type: "Actor",
  }, {
    entries: {},
  });
  const externalPack = createMappedCompendium({
    id: "ext.actors",
    name: "actors",
    type: "Actor",
    packageName: "ext",
    packageType: "module",
  }, {
    entries: {
      "actor-a": {
        name: "Goblin IT",
      },
    },
  });

  game.babele.packs = new TestCollection([["ext.actors", externalPack]]);

  const translated = Converters._fromPack(
    [
      {
        _id: "actor-a",
        name: "Goblin",
        prototypeToken: {
          name: "Goblin",
        },
        items: [],
        system: {
          details: {
            biography: {
              value: "Original biography",
            },
          },
        },
      },
    ],
    contextPack,
    new CompendiumRuntime({
      globalPacks: game.babele.packs,
      currentCompendium: contextPack,
    }),
  );

  assert.equal(translated[0].name, "Goblin IT");
  assert.equal(translated[0].prototypeToken.name, "Goblin IT");
});
