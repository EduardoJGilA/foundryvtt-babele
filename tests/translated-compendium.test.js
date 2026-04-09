import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

const {TestCollection} = installFoundryStubs();

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

const {TranslatedCompendium} = await import("../module/script/translated-compendium.js");

test("invalid reference packs do not throw and warn only once per target", () => {
  game.babele.packs = new TestCollection();
  warnings.length = 0;

  const tc = new TranslatedCompendium({
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

test("converter failures do not throw and leave the original document untouched when nothing else translates", () => {
  game.babele.converters.explode = () => {
    throw new Error("converter boom");
  };
  errors.length = 0;

  const tc = new TranslatedCompendium({
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

  assert.deepEqual(translated, data);
  assert.deepEqual(translatedAgain, data);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /converter 'explode' failed during translate/);
});

test("converter failures still allow other mapped fields to translate", () => {
  game.babele.converters.explode = () => {
    throw new Error("converter boom with partial translation");
  };
  errors.length = 0;

  const tc = new TranslatedCompendium({
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
