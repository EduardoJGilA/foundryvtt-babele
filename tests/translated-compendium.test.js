import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

const {TestCollection} = installFoundryStubs();

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => {
  warnings.push(args);
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

test.after(() => {
  console.warn = originalWarn;
});
