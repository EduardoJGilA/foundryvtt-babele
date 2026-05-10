import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {TranslationSources} = await import("../module/script/translation/translation-sources.js");
const {CompendiumTranslations} = await import("../module/script/translation/compendium-translations.js");
test("TranslationSources.loadTranslations merges multiple sources per collection and includes _packs-folders payloads", async () => {
  game.data.packs = [
    {type: "Item", packageName: "test", packageType: "module", name: "items"},
  ];

  const sources = new TranslationSources({
    discovery: {
      translationSources: async () => [
        {file: "modules/a/test.items.json", baseName: "test.items.json"},
        {file: "modules/b/test.items.json", baseName: "test.items.json"},
        {file: "modules/a/test._packs-folders.json", baseName: "test._packs-folders.json"},
      ],
      orderedSourcesFor: (_collection, translationSources) => translationSources,
    },
    jsonLoader: async (file) => {
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
    },
  });

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

test("TranslationSources.loadTranslations resolves inherited payloads after per-collection merge", async () => {
  const sources = new TranslationSources({
    discovery: {
      translationSources: async () => [
        {file: "modules/a/shared.base.json", baseName: "shared.base.json"},
        {file: "modules/a/test.items.json", baseName: "test.items.json"},
      ],
      orderedSourcesFor: (_collection, translationSources) => translationSources,
    },
    jsonLoader: async (file) => {
      if (file === "modules/a/shared.base.json") {
        return {
          entries: {
            sword: {name: "Sword"},
          },
          mapping: {
            description: "system.description.value",
          },
          reference: ["shared.reference"],
          types: ["weapon"],
        };
      }

      if (file === "modules/a/test.items.json") {
        return {
          extends: "shared.base",
          label: "Localized Items",
          entries: {
            sword: {name: "Spada"},
            shield: {name: "Scudo"},
          },
          folders: {
            Equipment: "Equipaggiamento",
          },
        };
      }

      throw new Error(`Unexpected file ${file}`);
    },
  });

  const translations = await sources.loadTranslations("en");
  const items = translations.for("test.items");

  assert.equal(items.label, "Localized Items");
  assert.deepEqual(items.entries, {
    sword: {name: "Spada"},
    shield: {name: "Scudo"},
  });
  assert.deepEqual(items.mapping, {
    description: "system.description.value",
  });
  assert.deepEqual(items.folders, {
    Equipment: "Equipaggiamento",
  });
  assert.deepEqual(items.reference, ["shared.reference"]);
  assert.deepEqual(items.types, ["weapon"]);
  assert.deepEqual(items.extends, ["shared.base"]);
});

test("CompendiumTranslations.resolveInheritance fails open on missing parents", () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    const translations = new CompendiumTranslations({
      translations: [
        {
          collection: "test.items",
          extends: "shared.base",
          entries: {
            sword: {name: "Spada"},
          },
        },
      ],
    }).resolveInheritance();

    assert.deepEqual(translations.for("test.items")?.entries, {
      sword: {name: "Spada"},
    });
    assert.match(String(warnings[0][0]), /extends missing parent 'shared\.base'/);
  } finally {
    console.warn = warn;
  }
});

test("CompendiumTranslations.resolveInheritance fails open on inheritance cycles", () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    const translations = new CompendiumTranslations({
      translations: [
        {
          collection: "shared.a",
          extends: "shared.b",
          entries: {
            a: {name: "A"},
          },
        },
        {
          collection: "shared.b",
          extends: "shared.a",
          entries: {
            b: {name: "B"},
          },
        },
      ],
    }).resolveInheritance();

    assert.deepEqual(translations.for("shared.a")?.entries, {
      b: {name: "B"},
      a: {name: "A"},
    });
    assert.deepEqual(translations.for("shared.b")?.entries, {
      a: {name: "A"},
      b: {name: "B"},
    });
    assert.match(String(warnings[0][0]), /inheritance cycle detected/);
  } finally {
    console.warn = warn;
  }
});
