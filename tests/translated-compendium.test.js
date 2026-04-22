import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const warnings = [];
const errors = [];
const originalWarn = console.warn;
const originalError = console.error;
console.warn = (...args) => {
  warnings.push(args);
};
console.error = (...args) => {
  errors.push(args);
};

const {MappedCompendium} = await import("../module/script/compendium/mapped-compendium.js");
const {default: Babel} = await import("../module/script/babele.js");
const defaultDocumentMappings = new Babel().documentMappings;

function translatedCompendium(metadata, translations, options = {}) {
  return new MappedCompendium(metadata, translations, {
    documentMappings: options.documentMappings ?? defaultDocumentMappings,
    translationStrategies: options.translationStrategies,
  });
}

test("invalid reference packs do not throw and warn only once per target", () => {
  game.babele = {
    mappedCompendiumFor() {
      return null;
    },
  };
  warnings.length = 0;

  const tc = translatedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    reference: "missing.pack",
    entries: {},
  });

  const data = {
    _id: "item-1",
    name: "Item One",
    system: {
      description: {
        value: "Description",
      },
    },
  };

  assert.equal(tc.hasReferenceTranslations(data), false);
  assert.equal(tc.hasReferenceTranslations(data), false);
  assert.doesNotThrow(() => tc.translate(data));
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /invalid reference pack 'missing\.pack'/);
});

test("MappedCompendium resolves entries with _id, then name, then sourceId precedence", () => {
  const tc = translatedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "doc-1": {name: "By Id"},
      "Longsword": {name: "By Name"},
      "source-1": {name: "By Source"},
    },
  });

  assert.equal(tc.translationKeyFor({
    _id: "doc-1",
    name: "Longsword",
    flags: {core: {sourceId: "Compendium.test.items.source-1"}},
  }), "doc-1");

  assert.equal(tc.translationKeyFor({
    _id: "missing-id",
    name: "Longsword",
    flags: {core: {sourceId: "Compendium.test.items.source-1"}},
  }), "Longsword");

  assert.equal(tc.translationKeyFor({
    _id: "missing-id",
    name: "Missing Name",
    _stats: {compendiumSource: "Compendium.test.items.source-1"},
  }), "source-1");
});

test("MappedCompendium translationsFor returns an empty object when no entry matches", () => {
  const tc = translatedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "doc-1": {name: "By Id"},
    },
  });

  assert.deepEqual(tc.translationsFor({
    _id: "missing-id",
    name: "Missing Name",
  }), {});
});

test("MappedCompendium hasTranslation rejects mismatched top-level document types", () => {
  const tc = translatedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "shared-id": {name: "Translated"},
    },
  });

  assert.equal(tc.hasTranslation({_id: "shared-id", name: "Shared"}, "Item"), true);
  assert.equal(tc.hasTranslation({_id: "shared-id", name: "Shared"}, "Actor"), false);
});

test("MappedCompendium hasTranslation is always false when the pack is not translated", () => {
  const tc = translatedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, null);

  assert.equal(tc.hasTranslation({_id: "shared-id", name: "Shared"}, "Item"), false);
});

test("converter failures do not throw and leave the original document untouched when nothing else translates", () => {
  game.babele = new Babel();
  game.babele.registerConverter("explode", () => {
    throw new Error("converter boom");
  });
  errors.length = 0;

  const tc = translatedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    mapping: {
      description: {
        path: "system.description.value",
        converter: "explode",
      },
    },
    entries: {
      "item-1": {
        description: "ignored",
      },
    },
  }, {
    documentMappings: game.babele.documentMappings,
  });

  const data = {
    _id: "item-1",
    name: "Original Item",
    system: {
      description: {
        value: "Original description",
      },
    },
  };

  const translated = tc.translate(structuredClone(data));
  const translatedAgain = tc.translate(structuredClone(data));

  assert.deepEqual(translated.system, data.system);
  assert.deepEqual(translatedAgain.system, data.system);
  assert.equal(translated.hasTranslation, true);
  assert.equal(translated.translated, false);
  assert.equal(translatedAgain.hasTranslation, true);
  assert.equal(translatedAgain.translated, false);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /converter 'explode' failed during translate/);
});

test("converter failures still allow other mapped fields to translate", () => {
  game.babele = new Babel();
  game.babele.registerConverter("explode", () => {
    throw new Error("converter boom with partial translation");
  });
  errors.length = 0;

  const tc = translatedCompendium({
    id: "test.items.partial",
    name: "items",
    type: "Item",
  }, {
    mapping: {
      description: {
        path: "system.description.value",
        converter: "explode",
      },
    },
    entries: {
      "item-2": {
        name: "Oggetto Tradotto",
        description: "ignored",
      },
    },
  }, {
    documentMappings: game.babele.documentMappings,
  });

  const data = {
    _id: "item-2",
    name: "Original Item",
    system: {
      description: {
        value: "Original description",
      },
    },
  };

  const translated = tc.translate(structuredClone(data));

  assert.equal(translated.name, "Oggetto Tradotto");
  assert.equal(translated.system.description.value, "Original description");
  assert.equal(translated.translated, true);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /converter 'explode' failed during translate/);
});

test.after(() => {
  console.warn = originalWarn;
  console.error = originalError;
});
