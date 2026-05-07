import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

const {TestCollection} = installFoundryStubs();

const {Converters} = await import("../module/script/converter/converters.js");
const {CompendiumRuntime} = await import("../module/script/compendium/compendium-runtime.js");
const {MappedCompendium} = await import("../module/script/compendium/mapped-compendium.js");
const {DocumentConverter} = await import("../module/script/converter/document-converter.js");
const {StructuredDataConverter} = await import("../module/script/converter/structured-data-converter.js");
const {default: Babel} = await import("../module/script/babele.js");
const defaultDocumentMappings = new Babel().documentMappings;

function mappedCompendium(metadata, translations, options = {}) {
  return new MappedCompendium(metadata, translations, {
    documentMappings: options.documentMappings ?? defaultDocumentMappings,
    translationStrategies: options.translationStrategies,
  });
}

function runtimeCompendium(documentType, metadata = {}, translations = null, options = {}) {
  return mappedCompendium({
    type: documentType,
    ...metadata,
  }, translations, options);
}

test("fromPack.extract exports embedded documents keyed by name with id fallback", () => {
  const converter = Converters.fromPack(null, "Item");
  const actorContext = runtimeCompendium("Actor", {name: "Actor"});

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

  const extracted = converter.extract(items, {name: "Actor"}, actorContext, {
    runtime: new CompendiumRuntime({
      currentCompendium: actorContext,
    }),
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

  const parentTc = mappedCompendium({
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
  const globalPacks = new TestCollection([["test.adventure", parentTc]]);

  const contextA = mappedCompendium({
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

  const contextB = mappedCompendium({
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
      globalPacks,
      localPacks: new TestCollection([["test.adventure::adventureA::items", contextA]]),
    }),
  });
  const extractedB = converter.extract(adventureB.items, adventureB, parentTc, {
    runtime: new CompendiumRuntime({
      globalPacks,
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

test("fromDefaultMapping falls back to runtime currentCompendium when legacy tc is missing", () => {
  const converter = Converters.fromDefaultMapping("Item", "items");

  const parentTc = mappedCompendium({
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
    },
  });

  const runtime = new CompendiumRuntime({
    currentCompendium: parentTc,
  });

  assert.doesNotThrow(() => {
    converter.prepare(
      [{
        _id: "item-a",
        name: "Original A",
        system: {
          description: {
            value: "Original description A",
          },
        },
      }],
      {
        "item-a": {
          name: "Translated A",
          description: "Description A",
        },
      },
      {
        _id: "adventureA",
        name: "Adventure A",
      },
      null,
      {},
      runtime,
    );
  });
});

test("functional document converters accept null legacy tc when runtime currentCompendium is available", () => {
  const runtimeTc = mappedCompendium({
    id: "test.actor-pack",
    name: "actor-pack",
    type: "Actor",
  }, {
    mapping: {
      items: {
        description: "system.description.value",
      },
    },
  });

  const converter = Converters.fromDefaultMapping("Item", "items");

  assert.doesNotThrow(() => {
    converter(
      [],
      {},
      {_id: "actor-1", name: "Actor"},
      null,
      {},
      new CompendiumRuntime({currentCompendium: runtimeTc}),
    );
  });
});

test("fromPack uses TranslationEntries fallback order for sourceId-based matches", () => {
  const actorContext = runtimeCompendium("Actor", {name: "Actor"});
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

  const translated = new DocumentConverter().translate({
    value: items,
    translation: {
      "shared-source": {
        name: "Translated Sword",
        description: "Translated description",
      },
    },
    source: {name: "Actor"},
    field: "items",
    path: "items",
    params: {
      path: "items",
      converter: "document",
      documentType: "Item",
      cardinality: "many",
      mapping: {
        description: "system.description.value",
      },
    },
    allTranslations: {},
    contextCompendium: actorContext,
    runtime: new CompendiumRuntime({
      currentCompendium: actorContext,
    }),
  });

  assert.equal(translated[0].name, "Translated Sword");
  assert.equal(translated[0].system.description.value, "Translated description");
  assert.equal(translated[0].translated, true);
});

test("pages converter uses TranslationEntries fallback order", () => {
  const journalContext = runtimeCompendium("JournalEntry", {id: "journal-1", name: "Rules"});
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
  }, {_id: "journal-1", name: "Rules"}, journalContext, null, new CompendiumRuntime({
    currentCompendium: journalContext,
  }));

  assert.equal(translated[0].name, "Translated Page");
  assert.equal(translated[0].image.caption, "Translated caption");
  assert.equal(translated[0].src, "translated.png");
  assert.equal(translated[0].text.content, "<p>Translated</p>");
  assert.equal(translated[0].video.width, 800);
  assert.equal(translated[0].video.height, 600);
});

test("document converter translates embedded-only document fields without external pack fallback", () => {
  const converter = new DocumentConverter();
  const journalContext = runtimeCompendium("JournalEntry", {id: "journal-1", name: "Rules"});
  const translated = converter.translate({
    value: [
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
    ],
    translation: {
      "page-source": {
        name: "Translated Page",
        caption: "Translated caption",
        src: "translated.png",
        text: "<p>Translated</p>",
        width: 800,
        height: 600,
      },
    },
    source: {_id: "journal-1", name: "Rules"},
    field: "pages",
    path: "pages",
    params: {
      path: "pages",
      converter: "document",
      documentType: "JournalEntryPage",
      cardinality: "many",
    },
    allTranslations: {},
    contextCompendium: journalContext,
    runtime: new CompendiumRuntime({
      currentCompendium: journalContext,
    }),
  });

  assert.equal(translated[0].name, "Translated Page");
  assert.equal(translated[0].image.caption, "Translated caption");
  assert.equal(translated[0].src, "translated.png");
  assert.equal(translated[0].text.content, "<p>Translated</p>");
  assert.equal(translated[0].video.width, 800);
  assert.equal(translated[0].video.height, 600);
});

test("document converter applies per-entry collection sort directives after translation", () => {
  const converter = new DocumentConverter();
  const journalContext = runtimeCompendium("JournalEntry", {id: "journal-1", name: "Bestiary"});
  const translated = converter.translate({
    value: [
      {_id: "dragon", name: "Dragon", sort: 1000},
      {_id: "intro", name: "Overview", sort: 2000},
      {_id: "aboleth", name: "Aboleth", sort: 3000},
      {_id: "behir", name: "Behir", sort: 4000},
    ],
    translation: {
      $sort: {
        by: "name",
        locale: "fr",
        first: ["intro"],
        ignoreLeadingWords: ["le", "la", "les"],
        ignoreLeadingPrefixes: ["l'"],
        ignoreWords: ["de"],
      },
      intro: {name: "Le sommaire"},
      dragon: {name: "Le dragon"},
      aboleth: {name: "L'aboleth"},
      behir: {name: "Béhir"},
    },
    source: {_id: "journal-1", name: "Bestiary"},
    field: "pages",
    path: "pages",
    params: {
      path: "pages",
      converter: "document",
      documentType: "JournalEntryPage",
      cardinality: "many",
    },
    allTranslations: {},
    contextCompendium: journalContext,
    runtime: new CompendiumRuntime({
      currentCompendium: journalContext,
    }),
  });

  assert.deepEqual(translated.map((page) => page._id), ["intro", "aboleth", "behir", "dragon"]);
  assert.deepEqual(translated.map((page) => page.sort), [1000, 2000, 3000, 4000]);
});

test("document converter applies grouped collection sort directives", () => {
  const converter = new DocumentConverter();
  const journalContext = runtimeCompendium("JournalEntry", {id: "journal-1", name: "Rules"});
  const translated = converter.translate({
    value: [
      {_id: "parent", name: "Parent", sort: 1000},
      {_id: "zeta", name: "Zeta", sort: 2000},
      {_id: "beta", name: "Beta", sort: 3000},
      {_id: "alpha", name: "Alpha", sort: 4000},
    ],
    translation: {
      $sort: {
        by: "name",
        groups: [
          {
            parent: "parent",
            ids: ["beta", "alpha"],
          },
        ],
      },
    },
    source: {_id: "journal-1", name: "Rules"},
    field: "pages",
    path: "pages",
    params: {
      path: "pages",
      converter: "document",
      documentType: "JournalEntryPage",
      cardinality: "many",
    },
    allTranslations: {},
    contextCompendium: journalContext,
    runtime: new CompendiumRuntime({
      currentCompendium: journalContext,
    }),
  });

  assert.deepEqual(translated.map((page) => page._id), ["parent", "alpha", "beta", "zeta"]);
});

test("pages.extract exports journal pages through the JournalEntryPage mapping", () => {
  const journalContext = runtimeCompendium("JournalEntry", {id: "journal-1", name: "Rules"});
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
  ], {_id: "journal-1", name: "Rules"}, journalContext, {
    runtime: new CompendiumRuntime({
      currentCompendium: journalContext,
    }),
  });

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

test("document converter extracts embedded documents through the configured document mapping", () => {
  const journalContext = runtimeCompendium("JournalEntry", {id: "journal-1", name: "Rules"});
  const extracted = new DocumentConverter().extract({
    value: [
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
    ],
    translation: undefined,
    source: {_id: "journal-1", name: "Rules"},
    field: "pages",
    path: "pages",
    params: {
      path: "pages",
      converter: "document",
      documentType: "JournalEntryPage",
      cardinality: "many",
    },
    allTranslations: {},
    contextCompendium: journalContext,
    runtime: new CompendiumRuntime({
      currentCompendium: journalContext,
    }),
  });

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

test("document converter falls back to the parent compendium custom mapping for embedded documents", () => {
  const adventureContext = runtimeCompendium("Adventure", {id: "adventure-1", name: "Adventure"}, {
    mapping: {
      actors: {
        description: "system.details.biography.value",
      },
    },
  });
  const translated = new DocumentConverter().translate({
    value: [
      {
        _id: "actor-1",
        name: "Goblin",
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
    translation: {
      "actor-1": {
        name: "Goblin IT",
        description: "Biografia tradotta",
      },
    },
    source: {_id: "adventure-1", name: "Adventure"},
    field: "actors",
    path: "actors",
    params: {
      path: "actors",
      converter: "document",
      documentType: "Actor",
      cardinality: "many",
    },
    allTranslations: {},
    contextCompendium: adventureContext,
    runtime: new CompendiumRuntime({
      currentCompendium: adventureContext,
    }),
  });

  assert.equal(translated[0].name, "Goblin IT");
  assert.equal(translated[0].system.details.biography.value, "Biografia tradotta");
});

test("structured data converter translates nested arrays by index and extracts arrays", () => {
  const converter = new StructuredDataConverter({
    path: "faces",
    cardinality: "many",
    mapping: {
      name: "name",
      text: "text",
    },
  });

  const faces = [
    {name: "Front", text: "Original front"},
    {name: "Back", text: "Original back"},
  ];

  const translated = converter.translate({
    value: faces,
    translation: [
      {text: "Tradotto fronte"},
      undefined,
    ],
    source: {_id: "card-1", name: "Card"},
    field: "faces",
    path: "faces",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  const extracted = converter.extract({
    value: faces,
    source: {_id: "card-1", name: "Card"},
    field: "faces",
    path: "faces",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  assert.equal(translated[0].text, "Tradotto fronte");
  assert.equal(translated[1].text, "Original back");
  assert.deepEqual(extracted, [
    {name: "Front", text: "Original front"},
    {name: "Back", text: "Original back"},
  ]);
});

test("structured data converter translates keyed objects by source key and extracts keyed objects", () => {
  const converter = new StructuredDataConverter({
    path: "levels",
    cardinality: "many",
    container: "keyed",
    mapping: {
      target: "target.value",
      range: "range.value",
    },
  });

  const levels = {
    "4": {
      target: {value: "1 creature"},
      range: {value: "30 feet"},
    },
    "8": {
      target: {value: "up to 10 creatures"},
      range: {value: "60 feet"},
    },
  };

  const translated = converter.translate({
    value: levels,
    translation: {
      "4": {
        target: "1 creatura",
      },
      "8": {
        range: "18 metri",
      },
    },
    source: {_id: "spell-1", name: "Spell"},
    field: "heightening",
    path: "system.heightening.levels",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  const extracted = converter.extract({
    value: levels,
    source: {_id: "spell-1", name: "Spell"},
    field: "heightening",
    path: "system.heightening.levels",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  assert.equal(translated["4"].target.value, "1 creatura");
  assert.equal(translated["4"].range.value, "30 feet");
  assert.equal(translated["8"].target.value, "up to 10 creatures");
  assert.equal(translated["8"].range.value, "18 metri");
  assert.deepEqual(extracted, {
    "4": {
      target: "1 creature",
      range: "30 feet",
    },
    "8": {
      target: "up to 10 creatures",
      range: "60 feet",
    },
  });
});

test("structured data converter applies conditional mapping variants per entry", () => {
  const converter = new StructuredDataConverter({
    path: "activities",
    cardinality: "many",
    container: "keyed",
    keys: ["_id", "name"],
    mapping: {
      name: "name",
      _variants: [{
        _when: {path: "type", in: ["attack"]},
        range: "range.special",
      }],
    },
  });

  const activities = {
    attack: {
      _id: "attack",
      type: "attack",
      name: "Bite",
      range: {
        special: "within reach",
      },
    },
    utility: {
      _id: "utility",
      type: "utility",
      name: "Roar",
      range: {
        special: "audible distance",
      },
    },
  };

  const translated = converter.translate({
    value: activities,
    translation: {
      attack: {
        name: "Morso",
        range: "entro portata",
      },
      utility: {
        name: "Ruggito",
        range: "distanza udibile",
      },
    },
    source: {_id: "item-1", name: "Creature Action"},
    field: "activities",
    path: "system.activities",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  const extracted = converter.extract({
    value: activities,
    source: {_id: "item-1", name: "Creature Action"},
    field: "activities",
    path: "system.activities",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  assert.equal(translated.attack.name, "Morso");
  assert.equal(translated.attack.range.special, "entro portata");
  assert.equal(translated.utility.name, "Ruggito");
  assert.equal(translated.utility.range.special, "audible distance");
  assert.deepEqual(extracted, {
    attack: {
      name: "Bite",
      range: "within reach",
    },
    utility: {
      name: "Roar",
    },
  });
});

test("structured data converter matches keyed objects by an internal property and exports the same template shape", () => {
  const converter = new StructuredDataConverter({
    path: "activities",
    cardinality: "many",
    container: "keyed",
    key: "name",
    mapping: {
      name: "name",
      condition: "activation.condition",
      range: "range.special",
    },
  });

  const activities = {
    a1b2c3: {
      name: "Cast",
      activation: {condition: ""},
      range: {special: "60 feet"},
    },
    d4e5f6: {
      name: "Cast at Higher Level",
      activation: {condition: "When heightened"},
      range: {special: "120 feet"},
    },
  };

  const translated = converter.translate({
    value: activities,
    translation: {
      Cast: {
        name: "Lancer",
        range: "18 metres",
      },
      "Cast at Higher Level": {
        condition: "Quand le sort est renforcé",
      },
    },
    source: {_id: "spell-1", name: "Spell"},
    field: "activities",
    path: "system.activities",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  const extracted = converter.extract({
    value: activities,
    source: {_id: "spell-1", name: "Spell"},
    field: "activities",
    path: "system.activities",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  assert.equal(translated.a1b2c3.name, "Lancer");
  assert.equal(translated.a1b2c3.range.special, "18 metres");
  assert.equal(translated.d4e5f6.name, "Cast at Higher Level");
  assert.equal(translated.d4e5f6.activation.condition, "Quand le sort est renforcé");
  assert.deepEqual(extracted, {
    Cast: {
      name: "Cast",
      condition: "",
      range: "60 feet",
    },
    "Cast at Higher Level": {
      name: "Cast at Higher Level",
      condition: "When heightened",
      range: "120 feet",
    },
  });
});

test("structured data converter falls back to source keys when keyed property matching is missing or duplicated", () => {
  const converter = new StructuredDataConverter({
    path: "activities",
    cardinality: "many",
    container: "keyed",
    key: "name",
    mapping: {
      name: "name",
      range: "range.special",
    },
  });

  const activities = {
    alpha: {
      name: "Shared Name",
      range: {special: "30 feet"},
    },
    beta: {
      name: "Shared Name",
      range: {special: "60 feet"},
    },
    gamma: {
      range: {special: "90 feet"},
    },
  };

  const translated = converter.translate({
    value: activities,
    translation: {
      "Shared Name": {
        range: "9 metres",
      },
      gamma: {
        range: "27 metres",
      },
    },
    source: {_id: "spell-1", name: "Spell"},
    field: "activities",
    path: "system.activities",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  const extracted = converter.extract({
    value: activities,
    source: {_id: "spell-1", name: "Spell"},
    field: "activities",
    path: "system.activities",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  assert.equal(translated.alpha.range.special, "9 metres");
  assert.equal(translated.beta.range.special, "9 metres");
  assert.equal(translated.gamma.range.special, "27 metres");
  assert.deepEqual(extracted, {
    "Shared Name": {
      name: "Shared Name",
      range: "30 feet",
    },
    beta: {
      name: "Shared Name",
      range: "60 feet",
    },
    gamma: {
      range: "90 feet",
    },
  });
});

test("structured data converter matches and exports using multiple internal keys in order", () => {
  const converter = new StructuredDataConverter({
    path: "activities",
    cardinality: "many",
    container: "keyed",
    keys: ["_id", "name"],
    mapping: {
      name: "name",
      range: "range.special",
    },
  });

  const activities = {
    activitySourceKey: {
      _id: "activity-id",
      name: "Activity Name",
      range: {special: "30 feet"},
    },
    duplicateSourceKey: {
      _id: "activity-id",
      name: "Duplicate Name",
      range: {special: "60 feet"},
    },
    nameOnlyTranslationSourceKey: {
      _id: "missing-activity-id",
      name: "Name Only Translation",
      range: {special: "75 feet"},
    },
    unnamedSourceKey: {
      range: {special: "90 feet"},
    },
  };

  const translated = converter.translate({
    value: activities,
    translation: {
      "activity-id": {
        name: "Attività da id",
        range: "9 metri",
      },
      "Duplicate Name": {
        name: "Attività da nome",
      },
      "Name Only Translation": {
        name: "Attività da nome fallback",
        range: "22,5 metri",
      },
      unnamedSourceKey: {
        range: "27 metri",
      },
    },
    source: {_id: "item-1", name: "Item"},
    field: "activities",
    path: "system.activities",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  const extracted = converter.extract({
    value: activities,
    source: {_id: "item-1", name: "Item"},
    field: "activities",
    path: "system.activities",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  assert.equal(translated.activitySourceKey.name, "Attività da id");
  assert.equal(translated.activitySourceKey.range.special, "9 metri");
  assert.equal(translated.duplicateSourceKey.name, "Attività da id");
  assert.equal(translated.duplicateSourceKey.range.special, "9 metri");
  assert.equal(translated.nameOnlyTranslationSourceKey.name, "Attività da nome fallback");
  assert.equal(translated.nameOnlyTranslationSourceKey.range.special, "22,5 metri");
  assert.equal(translated.unnamedSourceKey.range.special, "27 metri");
  assert.deepEqual(extracted, {
    "activity-id": {
      name: "Activity Name",
      range: "30 feet",
    },
    "Duplicate Name": {
      name: "Duplicate Name",
      range: "60 feet",
    },
    "missing-activity-id": {
      name: "Name Only Translation",
      range: "75 feet",
    },
    unnamedSourceKey: {
      range: "90 feet",
    },
  });
});

test("structured data converter supports multiple keys for array containers", () => {
  const converter = new StructuredDataConverter({
    path: "advancement",
    cardinality: "many",
    container: "array",
    keys: ["_id", "title"],
    mapping: {
      title: "title",
      hint: "hint",
    },
  });

  const advancement = [
    {
      _id: "level-1",
      title: "Level 1",
      hint: "Original hint",
    },
    {
      title: "Level 2",
      hint: "Second hint",
    },
  ];

  const translated = converter.translate({
    value: advancement,
    translation: {
      "level-1": {
        title: "Livello 1",
      },
      "Level 2": {
        hint: "Secondo suggerimento",
      },
    },
    source: {_id: "class-1", name: "Class"},
    field: "advancement",
    path: "system.advancement",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  const extracted = converter.extract({
    value: advancement,
    source: {_id: "class-1", name: "Class"},
    field: "advancement",
    path: "system.advancement",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  assert.equal(translated[0].title, "Livello 1");
  assert.equal(translated[0].hint, "Original hint");
  assert.equal(translated[1].title, "Level 2");
  assert.equal(translated[1].hint, "Secondo suggerimento");
  assert.deepEqual(extracted, {
    "level-1": {
      title: "Level 1",
      hint: "Original hint",
    },
    "Level 2": {
      title: "Level 2",
      hint: "Second hint",
    },
  });
});

test("structured data converter exposes sourceKey to nested converters for keyed containers", () => {
  const babele = new Babel();
  babele.registerConverter("sourceKeyEcho", {
    translate(context) {
      return `${context.sourceKey}:${context.translation}`;
    },
    extract(context) {
      return `${context.sourceKey}:${context.value}`;
    },
  });

  const contextPack = mappedCompendium({
    id: "test.spells",
    name: "spells",
    type: "Item",
  }, null, {
    documentMappings: babele.documentMappings,
  });

  const converter = new StructuredDataConverter({
    path: "overlays",
    cardinality: "many",
    container: "keyed",
    mapping: {
      marker: {
        path: "marker",
        converter: "sourceKeyEcho",
      },
    },
  });

  const overlays = {
    alpha: {marker: "original-a"},
    beta: {marker: "original-b"},
  };

  const runtime = new CompendiumRuntime({
    currentCompendium: contextPack,
  });

  const translated = converter.translate({
    value: overlays,
    translation: {
      alpha: {marker: "translated-a"},
      beta: {marker: "translated-b"},
    },
    source: {_id: "spell-1", name: "Spell"},
    field: "spellVariants",
    path: "system.overlays",
    params: {},
    contextCompendium: contextPack,
    runtime,
  });

  const extracted = converter.extract({
    value: overlays,
    source: {_id: "spell-1", name: "Spell"},
    field: "spellVariants",
    path: "system.overlays",
    params: {},
    contextCompendium: contextPack,
    runtime,
  });

  assert.equal(translated.alpha.marker, "alpha:translated-a");
  assert.equal(translated.beta.marker, "beta:translated-b");
  assert.deepEqual(extracted, {
    alpha: {marker: "alpha:original-a"},
    beta: {marker: "beta:original-b"},
  });
});

test("structured data converter maps scalar translations to valuePath for keyed array entries", () => {
  const converter = new StructuredDataConverter({
    path: "changes",
    cardinality: "many",
    container: "array",
    key: "key",
    valuePath: "value",
  });

  const changes = [
    {
      key: "system.description.value",
      mode: "override",
      value: "Original description",
    },
    {
      key: "name",
      mode: "add",
      value: "Original name suffix",
    },
    {
      key: "system.range.value",
      mode: "add",
      value: "30",
    },
  ];

  const translated = converter.translate({
    value: changes,
    translation: {
      "system.description.value": "Description traduite",
      name: "",
      "system.range.value": 0,
    },
    source: {_id: "effect-1", name: "Effect"},
    field: "changes",
    path: "changes",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  const extracted = converter.extract({
    value: changes,
    source: {_id: "effect-1", name: "Effect"},
    field: "changes",
    path: "changes",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  assert.equal(translated[0].value, "Description traduite");
  assert.equal(translated[1].value, "");
  assert.equal(translated[2].value, 0);
  assert.equal(translated[0].mode, "override");
  assert.deepEqual(extracted, {
    "system.description.value": "Original description",
    name: "Original name suffix",
    "system.range.value": "30",
  });
});

test("structured data converter maps scalar translations to valuePath for one structured value", () => {
  const converter = new StructuredDataConverter({
    path: "label",
    cardinality: "one",
    valuePath: "text.value",
  });

  const label = {
    text: {
      value: "Original label",
    },
    color: "red",
  };

  const translated = converter.translate({
    value: label,
    translation: "Etichetta tradotta",
    source: {_id: "entry-1", name: "Entry"},
    field: "label",
    path: "label",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  const extracted = converter.extract({
    value: label,
    source: {_id: "entry-1", name: "Entry"},
    field: "label",
    path: "label",
    params: {},
    runtime: new CompendiumRuntime(),
  });

  assert.deepEqual(translated, {
    text: {
      value: "Etichetta tradotta",
    },
    color: "red",
  });
  assert.equal(extracted, "Original label");
});

test("tableResults.extract prefers range keys and exports the canonical structured payload", () => {
  game.babele = new Babel();
  const tableTc = new MappedCompendium({
    id: "test.tables",
    name: "tables",
    type: "RollTable",
  }, null, {
    documentMappings: game.babele.documentMappings,
  });
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
  ], {_id: "table-1", name: "Encounter Table"}, tableTc);

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
  game.babele = new Babel();
  const tableTc = new MappedCompendium({
    id: "test.tables",
    name: "tables",
    type: "RollTable",
  }, null, {
    documentMappings: game.babele.documentMappings,
  });
  const extracted = Converters.tableResults().extract([
    {
      _id: "result-3",
      type: "document",
      name: "Fallback Result",
      description: "<p>No range present</p>",
    },
  ], {_id: "table-1", name: "Encounter Table"}, tableTc);

  assert.deepEqual(extracted, {
    "result-3": {
      name: "Fallback Result",
      description: "<p>No range present</p>",
    },
  });
});

test("tableResults translates using the TableResult identity fallback order", () => {
  game.babele = new Babel();
  const tableTc = new MappedCompendium({
    id: "test.tables",
    name: "tables",
    type: "RollTable",
  }, null, {
    documentMappings: game.babele.documentMappings,
  });
  const translated = Converters.tableResults()([
    {
      _id: "result-1",
      range: [1, 1],
      description: "<p>Wolf</p>",
    },
    {
      _id: "result-2",
      range: [2, 2],
      name: "Goblin",
      description: "<p>Goblin</p>",
    },
  ], {
    "1-1": {
      description: "<p>Lupo</p>",
    },
    "result-2": {
      name: "Goblin Tradotto",
    },
  }, {
    _id: "table-1",
    name: "Encounter Table",
  }, tableTc);

  assert.equal(translated[0].description, "<p>Lupo</p>");
  assert.equal(translated[1].name, "Goblin Tradotto");
});

test("tableResults falls back to the referenced compendium translation via documentUuid", () => {
  game.babele = new Babel();
  const itemTc = new MappedCompendium({
    id: "Compendium.test.items.Item.item-1",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "Charging Quiver": {
        name: "Заряжающий Колчан",
      },
    },
  }, {
    documentMappings: game.babele.documentMappings,
  });

  const tableTc = new MappedCompendium({
    id: "test.tables",
    name: "tables",
    type: "RollTable",
  }, null, {
    documentMappings: game.babele.documentMappings,
  });
  const runtime = new CompendiumRuntime({
    globalPacks: new TestCollection([["Compendium.test.items.Item.item-1", itemTc]]),
    currentCompendium: tableTc,
  });

  const translated = Converters.tableResults()([
    {
      _id: "result-1",
      type: "document",
      range: [3, 3],
      name: "Charging Quiver",
      documentUuid: "Compendium.test.items.Item.item-1",
    },
  ], {}, {
    _id: "table-1",
    name: "Encounter Table",
  }, tableTc, {}, runtime);

  assert.equal(translated[0].name, "Заряжающий Колчан");
  assert.equal(translated[0].translated, true);
});

test("tableResults keeps explicit RollTable result name translations over the documentUuid fallback", () => {
  game.babele = new Babel();
  let fallbackCalls = 0;
  const itemTc = new MappedCompendium({
    id: "Compendium.test.items.Item.item-1",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "Charging Quiver": {
        name: "Should Not Be Used",
      },
    },
  }, {
    documentMappings: game.babele.documentMappings,
  });
  const originalTranslateField = itemTc.translateField.bind(itemTc);
  itemTc.translateField = (...args) => {
    fallbackCalls += 1;
    return originalTranslateField(...args);
  };

  const tableTc = new MappedCompendium({
    id: "test.tables",
    name: "tables",
    type: "RollTable",
  }, null, {
    documentMappings: game.babele.documentMappings,
  });
  const runtime = new CompendiumRuntime({
    globalPacks: new TestCollection([["Compendium.test.items.Item.item-1", itemTc]]),
    currentCompendium: tableTc,
  });

  const translated = Converters.tableResults()([
    {
      _id: "result-1",
      type: "document",
      range: [3, 3],
      name: "Charging Quiver",
      documentUuid: "Compendium.test.items.Item.item-1",
    },
  ], {
    "3-3": {
      name: "Translated In RollTable",
    },
  }, {
    _id: "table-1",
    name: "Encounter Table",
  }, tableTc, {}, runtime);

  assert.equal(translated[0].name, "Translated In RollTable");
  assert.equal(fallbackCalls, 0);
});

test("tableResultsCollection delegates to the generic RollTable mapping", () => {
  game.babele = new Babel();
  const tableCollectionTc = new MappedCompendium({
    id: "test.tables",
    name: "tables",
    type: "RollTable",
  }, null, {
    documentMappings: game.babele.documentMappings,
  });
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
  }, {_id: "tables-collection", name: "Tables"}, tableCollectionTc);

  const extracted = Converters.tableResultsCollection().extract(
    tables,
    {_id: "tables-collection", name: "Tables"},
    tableCollectionTc,
  );

  assert.equal(translated[0].name, "Tabella Incontri");
  assert.equal(translated[0].results[0].description, "<p>Lupo</p>");
  assert.deepEqual(extracted, {
    "Encounter Table": {
      name: "Encounter Table",
      description: "",
      results: {
        "1-1": {
          description: "<p>Wolf</p>",
        },
      },
    },
  });
});

test("document converter handles Card collections through Card mappings including structured faces and back", () => {
  game.babele = new Babel();
  const deckContext = new MappedCompendium({
    id: "test.cards",
    name: "cards",
    type: "Cards",
  }, null, {
    documentMappings: game.babele.documentMappings,
  });
  const converter = new DocumentConverter({
    path: "cards",
    documentType: "Card",
    cardinality: "many",
  });

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

  const translated = converter.translate({
    value: cards,
    translation: {
      "card-1": {
        name: "Asso delle Stelle",
        faces: [
          {
            text: "Brilla intensa",
          },
        ],
      },
    },
    source: {_id: "deck-1", name: "Stars"},
    field: "cards",
    path: "cards",
    params: {},
    allTranslations: {},
    contextCompendium: deckContext,
    runtime: new CompendiumRuntime({
      currentCompendium: deckContext,
    }),
  });

  const extracted = converter.extract({
    value: cards,
    source: {_id: "deck-1", name: "Stars"},
    field: "cards",
    path: "cards",
    params: {},
    allTranslations: {},
    contextCompendium: deckContext,
    runtime: new CompendiumRuntime({
      currentCompendium: deckContext,
    }),
  });

  assert.equal(translated[0].name, "Asso delle Stelle");
  assert.equal(translated[0].faces[0].text, "Brilla intensa");
  assert.deepEqual(extracted, {
    "Ace of Stars": {
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
  });
});

test("document converter handles PlaylistSound collections through the PlaylistSound mapping", () => {
  const playlistContext = runtimeCompendium("Playlist", {id: "playlist-1", name: "Weather"});
  const converter = new DocumentConverter({
    path: "sounds",
    documentType: "PlaylistSound",
    cardinality: "many",
  });

  const sounds = [
    {
      _id: "sound-1",
      name: "Wind",
      description: "",
    },
  ];

  const translated = converter.translate({
    value: sounds,
    translation: {
      "sound-1": {
        name: "Vento",
      },
    },
    source: {_id: "playlist-1", name: "Weather"},
    field: "sounds",
    path: "sounds",
    params: {},
    allTranslations: {},
    contextCompendium: playlistContext,
    runtime: new CompendiumRuntime({
      currentCompendium: playlistContext,
    }),
  });

  const extracted = converter.extract({
    value: sounds,
    source: {_id: "playlist-1", name: "Weather"},
    field: "sounds",
    path: "sounds",
    params: {},
    allTranslations: {},
    contextCompendium: playlistContext,
    runtime: new CompendiumRuntime({
      currentCompendium: playlistContext,
    }),
  });

  assert.equal(translated[0].name, "Vento");
  assert.deepEqual(extracted, {
    Wind: {
      name: "Wind",
      description: "",
    },
  });
});

test("fromPack fallback only uses translated packs with the same document type", () => {
  const actorContext = runtimeCompendium("Actor", {name: "Actor"});
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

  const globalPacks = [actorPack, itemPack];

  const translated = new DocumentConverter().translate({
    value: [item],
    translation: undefined,
    source: {name: "Actor"},
    field: "items",
    path: "items",
    params: {
      path: "items",
      converter: "document",
      documentType: "Item",
      cardinality: "many",
      mapping: null,
    },
    allTranslations: {},
    contextCompendium: actorContext,
    runtime: new CompendiumRuntime({
      globalPacks,
      currentCompendium: actorContext,
    }),
  });

  assert.equal(translated[0].name, "Correct Item Translation");
});

test("fromPack translates embedded spell names through deterministic resolver lookup", () => {
  const actorContext = runtimeCompendium("Actor", {name: "Actor"});
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

  const spellsPack = mappedCompendium({
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

  const translated = new DocumentConverter().translate({
    value: [spell],
    translation: undefined,
    source: {name: "Actor"},
    field: "items",
    path: "items",
    params: {
      path: "items",
      converter: "document",
      documentType: "Item",
      cardinality: "many",
      mapping: {
        description: "system.description.value",
      },
    },
    allTranslations: {},
    contextCompendium: actorContext,
    runtime: new CompendiumRuntime({
      globalPacks: new TestCollection([["test.spells", spellsPack]]),
      currentCompendium: actorContext,
    }),
  });

  assert.equal(translated[0].name, "Dardo Incantato");
  assert.equal(translated[0].system.description.value, "Descrizione tradotta");
  assert.equal(translated[0].translated, true);
});

test("document converter prefers the exact compendium source and layers actor item overrides", () => {
  const actorContext = runtimeCompendium("Actor", {name: "Actor"});
  const item = {
    _id: "actor-item-1",
    name: "Wrong Match Name",
    _stats: {
      compendiumSource: "Compendium.test.exact.Item.source-sword",
    },
    system: {
      description: {
        value: "Original embedded description",
      },
    },
  };

  const exactPack = mappedCompendium({
    id: "test.exact",
    name: "exact",
    type: "Item",
    packageName: "test",
    packageType: "module",
  }, {
    mapping: {
      description: "system.description.value",
    },
    entries: {
      "Original Sword": {
        name: "Exact Pack Translation",
        description: "Exact pack description",
      },
    },
  });

  const wrongPack = mappedCompendium({
    id: "test.wrong",
    name: "wrong",
    type: "Item",
    packageName: "test",
    packageType: "module",
  }, {
    mapping: {
      description: "system.description.value",
    },
    entries: {
      "Wrong Match Name": {
        name: "Wrong Pack Translation",
        description: "Wrong pack description",
      },
    },
  });

  const previousFromUuidSync = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => uuid === "Compendium.test.exact.Item.source-sword"
    ? {name: "Original Sword"}
    : null;

  try {
    const translated = new DocumentConverter().translate({
      value: [item],
      translation: {
        "actor-item-1": {
          name: "Actor Override Name",
        },
      },
      source: {name: "Actor"},
      field: "items",
      path: "items",
      params: {
        path: "items",
        converter: "document",
        documentType: "Item",
        cardinality: "many",
        mapping: null,
      },
      allTranslations: {},
      contextCompendium: actorContext,
      runtime: new CompendiumRuntime({
        globalPacks: new TestCollection([
          ["test.exact", exactPack],
          ["test.wrong", wrongPack],
        ]),
        currentCompendium: actorContext,
      }),
    });

    assert.equal(translated[0].name, "Actor Override Name");
    assert.equal(translated[0].system.description.value, "Exact pack description");
    assert.equal(translated[0].translated, true);
    assert.equal(translated[0].hasTranslation, true);
  } finally {
    globalThis.fromUuidSync = previousFromUuidSync;
  }
});

test("document converter restores the source name from the exact pack index when the source document is not cached", () => {
  const actorContext = runtimeCompendium("Actor", {name: "Actor"});
  const item = {
    _id: "actor-item-2",
    name: "Localized Runtime Name",
    _stats: {
      compendiumSource: "Compendium.test.exact.Item.source-axe",
    },
    system: {
      description: {
        value: "Original embedded description",
      },
    },
  };

  const exactPack = mappedCompendium({
    id: "test.exact",
    name: "exact",
    type: "Item",
    packageName: "test",
    packageType: "module",
  }, {
    mapping: {
      description: "system.description.value",
    },
    entries: {
      "Original Axe": {
        name: "Ascia Tradotta",
        description: "Descrizione ascia",
      },
    },
  });
  exactPack.index = new foundry.utils.Collection([[
    "source-axe",
    {
      _id: "source-axe",
      name: "Original Axe",
    },
  ]]);

  const previousFromUuidSync = globalThis.fromUuidSync;
  globalThis.fromUuidSync = () => null;

  try {
    const translated = new DocumentConverter().translate({
      value: [item],
      translation: undefined,
      source: {name: "Actor"},
      field: "items",
      path: "items",
      params: {
        path: "items",
        converter: "document",
        documentType: "Item",
        cardinality: "many",
        mapping: null,
      },
      allTranslations: {},
      contextCompendium: actorContext,
      runtime: new CompendiumRuntime({
        globalPacks: new TestCollection([["test.exact", exactPack]]),
        currentCompendium: actorContext,
      }),
    });

    assert.equal(translated[0].name, "Ascia Tradotta");
    assert.equal(translated[0].system.description.value, "Descrizione ascia");
    assert.equal(translated[0].translated, true);
    assert.equal(translated[0].hasTranslation, true);
  } finally {
    globalThis.fromUuidSync = previousFromUuidSync;
  }
});

test("document converter does not let converter-only local mappings override fallback pack translations without local entries", () => {
  const actorContext = runtimeCompendium("Actor", {name: "Actor"});
  const item = {
    _id: "actor-item-3",
    name: "Runtime Sword",
    _stats: {
      compendiumSource: "Compendium.test.exact.Item.source-sword-2",
    },
    system: {
      description: {
        value: "Original embedded description",
      },
      damage: {
        value: "weapon skill bonus",
      },
    },
  };

  const exactPack = mappedCompendium({
    id: "test.exact",
    name: "exact",
    type: "Item",
    packageName: "test",
    packageType: "module",
  }, {
    mapping: {
      description: "system.description.value",
      damage: {
        path: "system.damage.value",
        converter: "lookup",
        normalize: "trim-lowercase",
        values: {
          "weapon skill bonus": "Bonificador HA",
        },
      },
    },
    entries: {
      "Original Sword 2": {
        name: "Espada Tradotta",
        description: "Descrizione tradotta",
      },
    },
  });
  exactPack.index = new foundry.utils.Collection([[
    "source-sword-2",
    {
      _id: "source-sword-2",
      name: "Original Sword 2",
    },
  ]]);

  const previousFromUuidSync = globalThis.fromUuidSync;
  globalThis.fromUuidSync = () => null;

  try {
    const translated = new DocumentConverter().translate({
      value: [item],
      translation: undefined,
      source: {name: "Actor"},
      field: "items",
      path: "items",
      params: {
        path: "items",
        converter: "document",
        documentType: "Item",
        cardinality: "many",
        mapping: {
          damage: {
            path: "system.damage.value",
            converter: "lookup",
            normalize: "trim-lowercase",
            values: {
              "weapon skill bonus": "Bonificador HA local",
            },
          },
        },
      },
      allTranslations: {},
      contextCompendium: actorContext,
      runtime: new CompendiumRuntime({
        globalPacks: new TestCollection([["test.exact", exactPack]]),
        currentCompendium: actorContext,
      }),
    });

    assert.equal(translated[0].name, "Espada Tradotta");
    assert.equal(translated[0].system.description.value, "Descrizione tradotta");
    assert.equal(translated[0].system.damage.value, "Bonificador HA");
  } finally {
    globalThis.fromUuidSync = previousFromUuidSync;
  }
});

test("adventure actors translate tokenName through the embedded actor context", () => {
  game.babele = new Babel();
  game.babele.registerConverters({
    name: Converters.mappedField("name"),
    fromPack: Converters.fromPack(),
  });
  const converter = Converters.fromDefaultMapping("Actor", "actors");
  const adventure = new MappedCompendium({
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
  }, {
    documentMappings: game.babele.documentMappings,
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
  game.babele = new Babel();
  game.babele.registerConverters({
    name: Converters.mappedField("name"),
    fromPack: Converters.fromPack(),
  });

  const converter = Converters.fromDefaultMapping("Actor", "actors");
  const adventure = new MappedCompendium({
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
  }, {
    documentMappings: game.babele.documentMappings,
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
  game.babele = new Babel();
  game.babele.registerConverters({
    name: Converters.mappedField("name"),
    fromPack: Converters.fromPack(),
  });

  const contextPack = new MappedCompendium({
    type: "Actor",
  }, {
    entries: {},
  }, {
    documentMappings: game.babele.documentMappings,
  });
  const externalPack = new MappedCompendium({
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
  }, {
    documentMappings: game.babele.documentMappings,
  });

  const globalPacks = new TestCollection([["ext.actors", externalPack]]);

  const translated = new DocumentConverter().translate({
    value: [
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
    translation: undefined,
    source: {name: "Encounter"},
    field: "actors",
    path: "actors",
    params: {
      path: "actors",
      converter: "document",
      documentType: "Actor",
      cardinality: "many",
      mapping: null,
    },
    allTranslations: {},
    contextCompendium: contextPack,
    runtime: new CompendiumRuntime({
      globalPacks,
      currentCompendium: contextPack,
    }),
  });

  assert.equal(translated[0].name, "Goblin IT");
  assert.equal(translated[0].prototypeToken.name, "Goblin IT");
});

test("sceneRegions translates supported behavior text fields and ignores script source", () => {
  game.babele = new Babel();
  const sceneContext = new MappedCompendium({
    id: "test.scenes",
    name: "scenes",
    type: "Scene",
  }, null, {
    documentMappings: game.babele.documentMappings,
  });
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
          revealedDialog: "Attraversare?",
          unrevealedDialog: "Entrare nella nebbia?",
        },
        "behavior-3": {
          name: "Automazione",
          source: "console.log('tradotto');",
        },
      },
    },
  }, {_id: "scene-1", name: "Scene"}, sceneContext);

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
  game.babele = new Babel();
  const sceneContext = new MappedCompendium({
    id: "test.scenes",
    name: "scenes",
    type: "Scene",
  }, null, {
    documentMappings: game.babele.documentMappings,
  });
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
  ], {_id: "scene-1", name: "Scene"}, sceneContext);

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
          revealedDialog: "Step through?",
          unrevealedDialog: "Enter the mist?",
        },
        Automation: {
          name: "Automation",
        },
      },
    },
  });
});
