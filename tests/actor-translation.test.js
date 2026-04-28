import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {ActorTranslation} = await import("../module/script/actor/actor-translation.js");

function actorWithItems(items, onUpdate = async () => {}) {
  return {
    items: {
      contents: items.map((item) => ({
        id: item._id,
        name: item.name,
        toObject() {
          return {...item};
        },
      })),
    },
    async updateEmbeddedDocuments(documentType, updates) {
      await onUpdate(documentType, updates);
    },
  };
}

test("ActorTranslation builds a proposal without applying actor updates", () => {
  let updateCalled = false;
  const actor = actorWithItems([
    {_id: "item-1", name: "Sword"},
    {_id: "item-2", name: "Shield"},
  ], async () => {
    updateCalled = true;
  });

  const translatedPack = {
    translated: true,
    hasTranslation(data, documentType) {
      return documentType === "Item" && data._id === "item-1";
    },
    translate(data) {
      return {...data, name: "Spada"};
    },
  };

  const actorTranslation = new ActorTranslation({
    translatedPackFor(documentType, data) {
      return translatedPack.hasTranslation(data, documentType) ? translatedPack : null;
    },
  });

  const proposal = actorTranslation.proposal(actor);

  assert.equal(updateCalled, false);
  assert.deepEqual(proposal.summary(), {
    total: 2,
    translated: 1,
    untranslated: 1,
  });
  assert.deepEqual(proposal.updates(), [
    {_id: "item-1", name: "Spada"},
  ]);
  assert.equal(proposal.entries[0].name(), "Sword");
  assert.equal(proposal.entries[1].translated, false);
});

test("ActorTranslation applies only translated proposal entries", async () => {
  let applied = null;
  const actor = actorWithItems([
    {_id: "item-1", name: "Sword"},
    {_id: "item-2", name: "Shield"},
  ], async (documentType, updates) => {
    applied = {documentType, updates};
  });

  const actorTranslation = new ActorTranslation({
    mappedCompendiums: null,
    translatedPackFor(documentType, data) {
      if (documentType !== "Item" || data._id !== "item-2") {
        return null;
      }

      return {
        translate(source) {
          return {...source, name: "Scudo"};
        },
      };
    },
  });

  const proposal = actorTranslation.proposal(actor);
  const updates = await actorTranslation.apply(proposal);

  assert.deepEqual(updates, [
    {_id: "item-2", name: "Scudo"},
  ]);
  assert.deepEqual(applied, {
    documentType: "Item",
    updates: [
      {_id: "item-2", name: "Scudo"},
    ],
  });
});

test("ActorTranslation apply is a no-op when no proposal entry is translated", async () => {
  let updateCalled = false;
  const actor = actorWithItems([
    {_id: "item-1", name: "Sword"},
  ], async () => {
    updateCalled = true;
  });

  const actorTranslation = new ActorTranslation({
    mappedCompendiums: null,
    translatedPackFor() {
      return null;
    },
  });

  const proposal = actorTranslation.proposal(actor);
  const updates = await actorTranslation.apply(proposal);

  assert.deepEqual(updates, []);
  assert.equal(updateCalled, false);
});
