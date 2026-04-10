import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {TranslationResolver} = await import("../module/script/translation-resolver.js");

test("TranslationResolver prefers _id over name and sourceId", () => {
  const resolver = new TranslationResolver({
    "doc-1": {name: "By Id"},
    "Longsword": {name: "By Name"},
    "source-1": {name: "By Source"},
  });

  const resolution = resolver.resolutionFor({
    _id: "doc-1",
    name: "Longsword",
    flags: {core: {sourceId: "Compendium.test.items.source-1"}},
  });

  assert.equal(resolution.matched, true);
  assert.equal(resolution.key, "doc-1");
  assert.equal(resolution.strategy, "_id");
  assert.deepEqual(resolution.candidates, ["doc-1", "Longsword", "source-1"]);
});

test("TranslationResolver falls back to name and then sourceId", () => {
  const byName = new TranslationResolver({
    "Longsword": {name: "By Name"},
  });
  const bySource = new TranslationResolver({
    "source-2": {name: "By Source"},
  });

  assert.equal(
    byName.resolutionFor({
      _id: "missing-id",
      name: "Longsword",
    }).strategy,
    "name",
  );

  assert.equal(
    bySource.resolutionFor({
      _id: "missing-id",
      name: "Missing Name",
      _stats: {compendiumSource: "Compendium.test.items.source-2"},
    }).strategy,
    "sourceId",
  );
});

test("TranslationResolver deduplicates repeated candidate keys", () => {
  const resolver = new TranslationResolver({
    "same-key": {name: "Only One"},
  });

  const keys = resolver.keysFor({
    _id: "same-key",
    name: "same-key",
    flags: {core: {sourceId: "Compendium.test.items.same-key"}},
  });

  assert.deepEqual(keys, ["same-key"]);
});

test("TranslationResolver reports unmatched documents cleanly", () => {
  const resolver = new TranslationResolver({});
  const resolution = resolver.diagnosticsFor({
    _id: "missing-id",
    name: "Missing Name",
  });

  assert.equal(resolution.matched, false);
  assert.equal(resolution.key, null);
  assert.equal(resolution.translation, null);
  assert.equal(resolution.strategy, null);
  assert.deepEqual(resolution.candidates, ["missing-id", "Missing Name"]);
});

test("TranslationResolver accepts explicit strategies without changing the resolution model", () => {
  const resolver = new TranslationResolver(
    {
      "spell::feat": {name: "By Name And Type"},
      "Magic Missile": {name: "By Name"},
    },
    [
      ...TranslationResolver.defaultStrategies(),
      {
        name: "name+type",
        keyFor: (data) => data?.name && data?.type ? `${data.name}::${data.type}` : null,
      },
    ],
  );

  const resolution = resolver.resolutionFor({
    _id: "missing-id",
    name: "spell",
    type: "feat",
  });

  assert.equal(resolution.matched, true);
  assert.equal(resolution.key, "spell::feat");
  assert.equal(resolution.strategy, "name+type");
  assert.deepEqual(resolution.candidates, ["missing-id", "spell", "spell::feat"]);
});
