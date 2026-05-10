import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {TranslationEntries} = await import("../module/script/translation/translation-entries.js");

test("TranslationEntries prefers _id over name and sourceId", () => {
  const entries = new TranslationEntries({
    "doc-1": {name: "By Id"},
    "Longsword": {name: "By Name"},
    "source-1": {name: "By Source"},
  });

  const match = entries.matchFor({
    _id: "doc-1",
    name: "Longsword",
    flags: {core: {sourceId: "Compendium.test.items.source-1"}},
  });

  assert.equal(match.matched, true);
  assert.equal(match.key, "doc-1");
  assert.equal(match.strategy, "_id");
  assert.deepEqual(match.candidates, ["doc-1", "Longsword", "source-1"]);
});

test("TranslationEntries falls back to name and then sourceId", () => {
  const byName = new TranslationEntries({
    "Longsword": {name: "By Name"},
  });
  const bySource = new TranslationEntries({
    "source-2": {name: "By Source"},
  });

  assert.equal(
    byName.matchFor({
      _id: "missing-id",
      name: "Longsword",
    }).strategy,
    "name",
  );

  assert.equal(
    bySource.matchFor({
      _id: "missing-id",
      name: "Missing Name",
      _stats: {compendiumSource: "Compendium.test.items.source-2"},
    }).strategy,
    "sourceId",
  );
});

test("TranslationEntries deduplicates repeated candidate keys", () => {
  const entries = new TranslationEntries({
    "same-key": {name: "Only One"},
  });

  const keys = entries.candidateKeysFor({
    _id: "same-key",
    name: "same-key",
    flags: {core: {sourceId: "Compendium.test.items.same-key"}},
  });

  assert.deepEqual(keys, ["same-key"]);
});

test("TranslationEntries reports unmatched documents cleanly", () => {
  const entries = new TranslationEntries({});
  const match = entries.diagnosticsFor({
    _id: "missing-id",
    name: "Missing Name",
  });

  assert.equal(match.matched, false);
  assert.equal(match.key, null);
  assert.equal(match.entry, null);
  assert.equal(match.strategy, null);
  assert.deepEqual(match.candidates, ["missing-id", "Missing Name"]);
});

test("TranslationEntries prefers explicit match candidates from document identity context", () => {
  const entries = new TranslationEntries({
    "1-1": {description: "By Range"},
    "result-1": {description: "By Id"},
  });

  const match = entries.matchFor({
    _id: "result-1",
    range: [1, 1],
  }, {
    documentType: "TableResult",
    matchCandidates: ["1-1", "result-1"],
  });

  assert.equal(match.matched, true);
  assert.equal(match.key, "1-1");
  assert.equal(match.strategy, "identity");
  assert.deepEqual(match.candidates, ["1-1", "result-1"]);
});

test("TranslationEntries applies custom strategies before its internal defaults", () => {
  const entries = new TranslationEntries(
    {
      "spell::feat": {name: "By Name And Type"},
      "Magic Missile": {name: "By Name"},
    },
    [
      {
        name: "name+type",
        keyFor: (data) => data?.name && data?.type ? `${data.name}::${data.type}` : null,
      },
    ],
  );

  const match = entries.matchFor({
    _id: "missing-id",
    name: "spell",
    type: "feat",
  });

  assert.equal(match.matched, true);
  assert.equal(match.key, "spell::feat");
  assert.equal(match.strategy, "name+type");
  assert.deepEqual(match.candidates, ["spell::feat", "missing-id", "spell"]);
});

test("TranslationEntries accepts custom match strategies that inspect translation entries", () => {
  const entries = new TranslationEntries(
    {
      spell: {name: "Incantesimo", type: "spell"},
      feat: {name: "Talento", type: "feat"},
    },
    [
      {
        name: "entry-type",
        matches: (data, _key, entry) => entry.type === data?.type,
      },
    ],
  );

  const match = entries.matchFor({
    _id: "missing-id",
    name: "Shared Name",
    type: "feat",
  }, {
    documentType: "Item",
  });

  assert.equal(match.matched, true);
  assert.equal(match.key, "feat");
  assert.equal(match.strategy, "entry-type");
  assert.deepEqual(match.candidates, ["missing-id", "Shared Name", "feat"]);
});

test("TranslationEntries passes documentType through context to custom match strategies", () => {
  const entries = new TranslationEntries(
    {
      feat: {name: "Shared Name", type: "feat"},
    },
    [
      {
        name: "item-type-only",
        matches: (data, _key, entry, context) => (
          context.documentType === "Item"
          && entry.name === data?.name
          && entry.type === data?.type
        ),
      },
    ],
  );

  assert.equal(
    entries.hasEntryFor({name: "Shared Name", type: "feat"}, {documentType: "Item"}),
    true,
  );
  assert.equal(
    entries.hasEntryFor({name: "Shared Name", type: "feat"}, {documentType: "Actor"}),
    false,
  );
});

test("TranslationEntries normalizes legacy array payloads keyed by id", () => {
  const entries = new TranslationEntries([
    {id: "item-1", name: "Sword"},
    {id: "item-2", name: "Shield"},
  ]);

  assert.deepEqual(entries.keys(), ["item-1", "item-2"]);
  assert.deepEqual(entries.at("item-1"), {id: "item-1", name: "Sword"});
});
