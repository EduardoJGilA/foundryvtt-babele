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

test("pages.extract exports journal pages through the JournalEntryPage mapping", () => {
  const extracted = Converters.pages().extract([
    {
      _id: "page-1",
      name: "Introduction",
      image: {
        caption: "Cover",
      },
      src: "intro.webp",
      text: {
        content: "<p>Hello</p>",
      },
      video: {
        width: 640,
        height: 480,
      },
    },
  ]);

  assert.deepEqual(extracted, {
    Introduction: {
      name: "Introduction",
      caption: "Cover",
      src: "intro.webp",
      text: "<p>Hello</p>",
      width: 640,
      height: 480,
    },
  });
});

test("tableResults.extract prefers range keys and exports the canonical structured payload", () => {
  const extracted = Converters.tableResults().extract([
    {
      _id: "result-1",
      type: "text",
      range: [1, 1],
      description: "<p>Keep out</p>",
      img: "icons/svg/d20.svg",
      weight: 1,
    },
    {
      _id: "result-2",
      type: "document",
      range: [2, 3],
      name: "Goblin",
      description: "<p>Small green menace</p>",
      img: "icons/svg/mystery-man.svg",
      weight: 2,
    },
  ]);

  assert.deepEqual(extracted, {
    "1-1": {
      description: "<p>Keep out</p>",
    },
    "2-3": {
      name: "Goblin",
      description: "<p>Small green menace</p>",
    },
  });
});

test("tableResults.extract falls back to result id when no range key is available", () => {
  const extracted = Converters.tableResults().extract([
    {
      _id: "result-3",
      type: "document",
      name: "Fallback Result",
      description: "<p>No range present</p>",
    },
  ]);

  assert.deepEqual(extracted, {
    "result-3": {
      name: "Fallback Result",
      description: "<p>No range present</p>",
    },
  });
});

test("tableResultsCollection uses TranslationResolver fallback order and exports only present fields", () => {
  const tables = [
    {
      _id: "table-1",
      name: "Encounter Table",
      description: "",
      results: [
        {
          _id: "result-1",
          range: [1, 1],
          description: "<p>Wolf</p>",
        },
      ],
    },
  ];

  const translated = Converters.tableResultsCollection()(tables, {
    "table-1": {
      name: "Tabella Incontri",
      results: {
        "1-1": {
          description: "<p>Lupo</p>",
        },
      },
    },
  });

  const extracted = Converters.tableResultsCollection().extract(tables);

  assert.equal(translated[0].name, "Tabella Incontri");
  assert.equal(translated[0].results[0].description, "<p>Lupo</p>");
  assert.deepEqual(extracted, {
    "Encounter Table": {
      name: "Encounter Table",
      results: {
        "1-1": {
          description: "<p>Wolf</p>",
        },
      },
    },
  });
});

test("deckCards uses TranslationResolver fallback order and export keeps only present translatable fields", () => {
  const cards = [
    {
      _id: "card-1",
      name: "Ace of Stars",
      description: "",
      faces: [
        {
          name: "Front",
          text: "Shines bright",
        },
      ],
      back: {
        name: "Back",
      },
    },
  ];

  const translated = Converters.deckCards()(cards, {
    "card-1": {
      name: "Asso delle Stelle",
      faces: [
        {
          text: "Brilla intensa",
        },
      ],
    },
  });

  const extracted = Converters.deckCards().extract(cards);

  assert.equal(translated[0].name, "Asso delle Stelle");
  assert.equal(translated[0].faces[0].text, "Brilla intensa");
  assert.deepEqual(extracted, {
    "Ace of Stars": {
      name: "Ace of Stars",
      faces: [
        {
          name: "Front",
          text: "Shines bright",
        },
      ],
      back: {
        name: "Back",
      },
    },
  });
});

test("playlistSounds uses TranslationResolver fallback order and export omits missing fields", () => {
  const sounds = [
    {
      _id: "sound-1",
      name: "Wind",
      description: "",
    },
  ];

  const translated = Converters.playlistSounds()(sounds, {
    "sound-1": {
      name: "Vento",
    },
  });

  const extracted = Converters.playlistSounds().extract(sounds);

  assert.equal(translated[0].name, "Vento");
  assert.deepEqual(extracted, {
    Wind: {
      name: "Wind",
    },
  });
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

test("fromPack translates embedded spell names through deterministic resolver lookup", () => {
  const spell = {
    _id: "spell-1",
    name: "Magic Missile",
    flags: {
      core: {
        sourceId: "Compendium.test.spells.magic-missile",
      },
    },
    system: {
      description: {
        value: "Original spell description",
      },
    },
  };

  const spellsPack = createMappedCompendium({
    id: "test.spells",
    name: "spells",
    type: "Item",
    packageName: "test",
    packageType: "module",
  }, {
    mapping: {
      description: "system.description.value",
    },
    entries: {
      "magic-missile": {
        name: "Dardo Incantato",
        description: "Descrizione tradotta",
      },
    },
  });

  const translated = Converters._fromPack(
    [spell],
    createMappedCompendium({type: "Item"}, {entries: {}}),
    new CompendiumRuntime({
      globalPacks: new TestCollection([["test.spells", spellsPack]]),
    }),
  );

  assert.equal(translated[0].name, "Dardo Incantato");
  assert.equal(translated[0].system.description.value, "Descrizione tradotta");
  assert.equal(translated[0].translated, true);
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

test("adventure deep translation keeps nested actor items inside the adventure-local scope", () => {
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
            items: {
              "item-a": {
                name: "Spada IT",
              },
            },
          },
        },
        items: {
          "item-a": {
            name: "Spada IT",
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
        items: [
          {
            _id: "item-a",
            name: "Sword",
          },
        ],
        system: {
          details: {
            biography: {
              value: "Original biography",
            },
          },
        },
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
  assert.equal(translated[0].items[0].name, "Spada IT");
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

test("sceneRegions translates supported behavior text fields and ignores script source", () => {
  const regions = [
    {
      _id: "region-1",
      name: "Haunted Hall",
      behaviors: [
        {
          _id: "behavior-1",
          type: "displayScrollingText",
          name: "Warning",
          system: {
            text: "Keep out",
            color: "#ffffff",
          },
        },
        {
          _id: "behavior-2",
          type: "teleportToken",
          name: "Portal",
          system: {
            dialog: {
              revealed: "Step through?",
              unrevealed: "Enter the mist?",
            },
          },
        },
        {
          _id: "behavior-3",
          type: "executeScript",
          name: "Automation",
          system: {
            source: "console.log('do not translate');",
          },
        },
      ],
    },
  ];

  const translated = Converters.sceneRegions()(regions, {
    "region-1": {
      name: "Corridoio infestato",
      behaviors: {
        "behavior-1": {
          name: "Avviso",
          text: "Non entrare",
        },
        "behavior-2": {
          name: "Portale",
          dialog: {
            revealed: "Attraversare?",
            unrevealed: "Entrare nella nebbia?",
          },
        },
        "behavior-3": {
          name: "Automazione",
          source: "console.log('tradotto');",
        },
      },
    },
  });

  assert.equal(translated[0].name, "Corridoio infestato");
  assert.equal(translated[0].behaviors[0].name, "Avviso");
  assert.equal(translated[0].behaviors[0].system.text, "Non entrare");
  assert.equal(translated[0].behaviors[1].name, "Portale");
  assert.equal(translated[0].behaviors[1].system.dialog.revealed, "Attraversare?");
  assert.equal(translated[0].behaviors[1].system.dialog.unrevealed, "Entrare nella nebbia?");
  assert.equal(translated[0].behaviors[2].name, "Automazione");
  assert.equal(translated[0].behaviors[2].system.source, "console.log('do not translate');");
});

test("sceneRegions.extract exports supported behavior text fields only", () => {
  const extracted = Converters.sceneRegions().extract([
    {
      _id: "region-1",
      name: "Haunted Hall",
      behaviors: [
        {
          _id: "behavior-1",
          type: "displayScrollingText",
          name: "Warning",
          system: {
            text: "Keep out",
            color: "#ffffff",
          },
        },
        {
          _id: "behavior-2",
          type: "teleportToken",
          name: "Portal",
          system: {
            dialog: {
              revealed: "Step through?",
              unrevealed: "Enter the mist?",
            },
            transition: {
              type: "fade",
            },
          },
        },
        {
          _id: "behavior-3",
          type: "executeScript",
          name: "Automation",
          system: {
            source: "console.log('do not export');",
          },
        },
      ],
    },
  ]);

  assert.deepEqual(extracted, {
    "Haunted Hall": {
      name: "Haunted Hall",
      behaviors: {
        Warning: {
          name: "Warning",
          text: "Keep out",
        },
        Portal: {
          name: "Portal",
          dialog: {
            revealed: "Step through?",
            unrevealed: "Enter the mist?",
          },
        },
        Automation: {
          name: "Automation",
        },
      },
    },
  });
});
