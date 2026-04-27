import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";
import {assignMappedCompendiums} from "./helpers/mapped-compendiums.js";

installFoundryStubs();

const {MappedCompendium} = await import("../module/script/compendium/mapped-compendium.js");
const {default: Babel} = await import("../module/script/babele.js");
const defaultDocumentMappings = new Babel().documentMappings;

function mappedCompendium(metadata, translations, options = {}) {
  return new MappedCompendium(metadata, translations, {
    documentMappings: options.documentMappings ?? defaultDocumentMappings,
    translationStrategies: options.translationStrategies,
  });
}

test("MappedCompendium is the canonical compendium model", () => {
  const compendium = mappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "item-1": {
        name: "Spada",
      },
    },
  });

  assert.equal(compendium instanceof MappedCompendium, true);
  assert.equal(compendium.hasTranslation({_id: "item-1", name: "Sword"}), true);
});

test("MappedCompendium translates index rows in place", () => {
  const compendium = mappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "item-1": {
        name: "Spada",
      },
    },
  });
  const index = [{_id: "item-1", name: "Sword"}];

  const result = compendium.translateIndex(index);

  assert.equal(result, index);
  assert.equal(index[0].name, "Spada");
  assert.equal(index[0].translated, true);
});

test("MappedCompendium caches translated index rows across equivalent index payloads", () => {
  const compendium = mappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "item-1": {
        name: "Spada",
      },
    },
  });

  let resolutionCalls = 0;
  const originalMatchFor = compendium.translationEntries.matchFor.bind(compendium.translationEntries);
  compendium.translationEntries.matchFor = (...args) => {
    resolutionCalls += 1;
    return originalMatchFor(...args);
  };

  const firstIndex = [{_id: "item-1", name: "Sword"}];
  const secondIndex = [{_id: "item-1", name: "Sword"}];

  compendium.translateIndex(firstIndex);
  compendium.translateIndex(secondIndex);

  assert.equal(firstIndex[0].name, "Spada");
  assert.equal(secondIndex[0].name, "Spada");
  assert.equal(resolutionCalls, 1);
});

test("MappedCompendium clears cached index translations when strategies change", () => {
  const metadata = {
    id: "test.items",
    name: "items",
    type: "Item",
  };
  const translations = {
    entries: {
      alt: {
        name: "Ascia",
      },
    },
  };
  let compendium = mappedCompendium(metadata, translations);

  compendium = mappedCompendium(metadata, translations, {
    translationStrategies: [
      {
        name: "alt-key",
        keyFor: () => "alt",
      },
    ],
  });

  const firstIndex = [{_id: "item-1", name: "Sword"}];
  compendium.translateIndex(firstIndex);
  assert.equal(firstIndex[0].name, "Ascia");

  compendium = mappedCompendium(metadata, translations, {
    translationStrategies: [
      {
        name: "missing-key",
        keyFor: () => "missing",
      },
    ],
  });

  const secondIndex = [{_id: "item-1", name: "Sword"}];
  compendium.translateIndex(secondIndex);
  assert.equal(secondIndex[0].name, "Sword");
});

test("MappedCompendium leaves documents unchanged when no translation entry matches", () => {
  const compendium = mappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {},
  });
  const data = {
    _id: "missing",
    name: "Sword",
    system: {
      description: {
        value: "Original description",
      },
    },
  };

  assert.deepEqual(compendium.translate(data), data);
});

test("MappedCompendium exposes a hook to patch translated document data before merge", () => {
  const compendium = mappedCompendium({
    id: "test.effects",
    name: "effects",
    type: "Item",
  }, {
    entries: {
      "effect-cover": {
        name: "Effet : Abri",
      },
    },
  });
  const data = {
    _id: "effect-cover",
    name: "Effect: Cover",
    type: "effect",
    system: {
      rules: [
        {
          key: "FlatModifier",
          slug: "explicit-cover",
          selector: "ac",
          type: "circumstance",
          value: 2,
        },
      ],
    },
  };

  Hooks.once("babele.translateDocumentData", (context) => {
    context.translated = foundry.utils.mergeObject(context.translated, {
      system: {
        rules: [
          {
            key: "FlatModifier",
            slug: "cover",
            selector: "ac",
            type: "circumstance",
            value: 2,
          },
        ],
      },
    }, {inplace: false});
  });

  const translated = compendium.translate(data);

  assert.equal(translated.name, "Effet : Abri");
  assert.equal(translated.system.rules[0].slug, "cover");
});

test("MappedCompendium fails open when translateDocumentData hook listeners throw", () => {
  const compendium = mappedCompendium({
    id: "test.effects",
    name: "effects",
    type: "Item",
  }, {
    entries: {
      "effect-cover": {
        name: "Effet : Abri",
      },
    },
  });
  const data = {
    _id: "effect-cover",
    name: "Effect: Cover",
    type: "effect",
    system: {
      rules: [
        {
          key: "FlatModifier",
          selector: "ac",
          type: "circumstance",
          value: 2,
        },
      ],
    },
  };

  Hooks.once("babele.translateDocumentData", () => {
    throw new Error("hook failure");
  });

  const translated = compendium.translate(data);

  assert.equal(translated.name, "Effet : Abri");
  assert.equal(translated.system.rules[0].slug, undefined);
});

test("MappedCompendium marks hasTranslation without marking translated when the merged payload is unchanged", () => {
  const compendium = mappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "item-1": {
        name: "Sword",
      },
    },
  });
  const data = {
    _id: "item-1",
    name: "Sword",
  };

  const translated = compendium.translate(data);

  assert.equal(translated.name, "Sword");
  assert.equal(translated.hasTranslation, true);
  assert.equal(translated.translated, false);
  assert.equal(translated.flags.babele.hasTranslation, true);
  assert.equal(translated.flags.babele.translated, false);
});

test("MappedCompendium exposes translated pack labels through metadata", () => {
  const compendium = mappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
    label: "Items",
  }, {
    label: "Oggetti",
    entries: {},
  });

  assert.equal(compendium.metadata.label, "Oggetti");
});

test("MappedCompendium extracts document payloads without requiring translations", () => {
  const compendium = mappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    mapping: {
      description: "system.description.value",
    },
    entries: {},
  });

  assert.deepEqual(compendium.extract({
    _id: "item-1",
    name: "Sword",
    system: {
      description: {
        value: "Original description",
      },
    },
  }), {
    name: "Sword",
    description: "Original description",
  });
});

test("createMappedCompendium returns the canonical mapped compendium for Adventure packs", () => {
  const compendium = mappedCompendium({
    id: "test.adventure",
    name: "adventure",
    type: "Adventure",
  }, {
    entries: {},
  });

  assert.equal(compendium instanceof MappedCompendium, true);
});

test("createMappedCompendium keeps Adventure entry virtual packs as mapped compendiums", () => {
  const compendium = mappedCompendium({
    id: "test.adventure::adventureA::items",
    name: "test.adventure::adventureA::items",
    type: "Item",
    virtual: true,
    adventureCollection: "test.adventure",
    adventureEntryKey: "adventureA",
  }, {
    entries: {},
  });

  assert.equal(compendium instanceof MappedCompendium, true);
});

test("createMappedCompendium preserves Adventure translation access", () => {
  const parent = mappedCompendium({
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
  const translations = parent.translationsFor({
    _id: "adventureA",
    name: "Adventure A",
  });

  assert.deepEqual(translations.items?.["item-a"], {
    name: "Translated A",
    description: "Description A",
  });
});

test("Babel delegates translation and extraction operations to MappedCompendium", () => {
  const babele = new Babel();
  const translatedCompendium = mappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "item-1": {
        name: "Spada",
      },
    },
  }, {
    documentMappings: babele.documentMappings,
    translationStrategies: babele.translationMatchStrategies(),
  });

  assignMappedCompendiums(babele, [["test.items", translatedCompendium]]);

  assert.equal(babele.isTranslated("test.items"), true);
  assert.equal(babele.translate("test.items", {_id: "item-1", name: "Sword"}).name, "Spada");
  assert.equal(babele.translateField("name", "test.items", {_id: "item-1", name: "Sword"}), "Spada");
  assert.equal(babele.translateIndex([{_id: "item-1", name: "Sword"}], "test.items")[0].name, "Spada");
});

test("Babel applies registered translation match strategies when mapped compendiums are built", () => {
  const babele = new Babel();
  babele.registerTranslationMatchStrategy({
    name: "entry-type",
    matches: (data, _key, translation, context) => (
      context.documentType === "Item" && translation.type === data?.type
    ),
  });

  const translatedCompendium = mappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      feat: {
        name: "Talento Tradotto",
        type: "feat",
      },
    },
  }, {
    documentMappings: babele.documentMappings,
    translationStrategies: babele.translationMatchStrategies(),
  });

  assignMappedCompendiums(babele, [["test.items", translatedCompendium]]);

  assert.equal(
    babele.mappedCompendiumFor("test.items").hasTranslation({_id: "missing-id", name: "Shared", type: "feat"}),
    true,
  );
});

test("Babel.init registers supported packs as mapped compendiums even without translations", async () => {
  const babele = new Babel();
  game.data.packs = [{
    type: "Item",
    packageName: "test",
    packageType: "module",
    name: "items",
    label: "Items",
  }];

  assert.equal(await babele.init(), true);
  assert.equal(babele.mappedCompendiumFor("test.items") instanceof MappedCompendium, true);
  assert.equal(babele.isTranslated("test.items"), false);
});

test("Babel extracts using the mapped compendium registered at init even when untranslated", async () => {
  const babele = new Babel();
  game.data.packs = [{
    type: "Item",
    packageName: "test",
    packageType: "module",
    name: "items",
    label: "Items",
  }];

  await babele.init();
  const extracted = babele.extract("test.items", {
    _id: "item-1",
    name: "Sword",
    system: {
      description: {
        value: "Original description",
      },
    },
  });

  assert.deepEqual(extracted, {
    name: "Sword",
    description: "Original description",
  });
  assert.equal(!!babele.mappedCompendiumFor("test.items"), true);
});
