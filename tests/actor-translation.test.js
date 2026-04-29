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
    {_id: "item-1", name: "Sword", type: "weapon"},
    {_id: "item-2", name: "Shield", type: "armor"},
  ], async () => {
    updateCalled = true;
  });

  const translatedPack = {
    translated: true,
    metadata: {
      collection: "test.items",
      label: "Translated Items",
    },
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
    ready: 1,
    translated: 0,
    untranslated: 1,
  });
  assert.deepEqual(proposal.updates(), [
    {
      _id: "item-1",
      name: "Spada",
      type: "weapon",
      originalName: "Sword",
      hasTranslation: true,
      translated: true,
      flags: {
        babele: {
          originalName: "Sword",
          hasTranslation: true,
          translated: true,
        },
      },
    },
  ]);
  assert.equal(proposal.entries[0].name(), "Sword");
  assert.equal(proposal.entries[0].type(), "weapon");
  assert.equal(proposal.entries[0].packLabel(), "Translated Items");
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
    {
      _id: "item-2",
      name: "Scudo",
      originalName: "Shield",
      hasTranslation: true,
      translated: true,
      flags: {
        babele: {
          originalName: "Shield",
          hasTranslation: true,
          translated: true,
        },
      },
    },
  ]);
  assert.deepEqual(applied, {
    documentType: "Item",
    updates: [
      {
        _id: "item-2",
        name: "Scudo",
        originalName: "Shield",
        hasTranslation: true,
        translated: true,
        flags: {
          babele: {
            originalName: "Shield",
            hasTranslation: true,
            translated: true,
          },
        },
      },
    ],
  });
});

test("ActorTranslation preserves multiple translation candidates for ambiguous actor items", async () => {
  let applied = null;
  const actor = actorWithItems([
    {_id: "item-1", name: "Unarmed Strike", type: "weapon"},
  ], async (documentType, updates) => {
    applied = {documentType, updates};
  });
  const pack2014 = translatedCandidatePack("dnd5e.items", "2014 Items", "Coup à mains nues");
  const pack2024 = translatedCandidatePack("dnd5e.actions", "2024 Actions", "Frappe à mains nues");

  const actorTranslation = new ActorTranslation({
    mappedCompendiums: [pack2014, pack2024],
    translatedPackFor() {
      return pack2014;
    },
  });

  const proposal = actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.deepEqual(entry.candidates.map((candidate) => ({
    id: candidate.id,
    label: candidate.packLabel(),
    proposedName: candidate.proposedName(),
  })), [
    {id: "dnd5e.items::0", label: "2014 Items", proposedName: "Coup à mains nues"},
    {id: "dnd5e.actions::1", label: "2024 Actions", proposedName: "Frappe à mains nues"},
  ]);
  assert.equal(entry.proposedName(), "Coup à mains nues");

  entry.selectCandidate("dnd5e.actions::1");
  assert.equal(entry.proposedName(), "Frappe à mains nues");

  const updates = await actorTranslation.apply(proposal);
  assert.deepEqual(updates, [
    {
      _id: "item-1",
      name: "Frappe à mains nues",
      originalName: "Unarmed Strike",
      hasTranslation: true,
      translated: true,
      flags: {
        babele: {
          originalName: "Unarmed Strike",
          hasTranslation: true,
          translated: true,
        },
      },
    },
  ]);
  assert.deepEqual(applied, {
    documentType: "Item",
    updates,
  });
});

test("ActorTranslation does not apply no-op translations", () => {
  const actor = actorWithItems([
    {_id: "item-1", name: "Rations", type: "consumable"},
  ]);

  const actorTranslation = new ActorTranslation({
    translatedPackFor(documentType, data) {
      if (documentType !== "Item" || data._id !== "item-1") {
        return null;
      }

      return {
        metadata: {
          label: "Translated Items",
        },
        translate(source) {
          return {name: source.name};
        },
      };
    },
  });

  const proposal = actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.deepEqual(proposal.summary(), {
    total: 1,
    ready: 0,
    translated: 1,
    untranslated: 0,
  });
  assert.equal(entry.hasTranslation(), true);
  assert.equal(entry.changed, false);
  assert.equal(entry.applicable(), false);
  assert.deepEqual(proposal.updates(), []);
});

function translatedCandidatePack(collection, label, translatedName) {
  return {
    translated: true,
    metadata: {
      type: "Item",
      collection,
      label,
    },
    hasTranslation(data, documentType) {
      return documentType === "Item" && data.name === "Unarmed Strike";
    },
    translate() {
      return {name: translatedName};
    },
  };
}

test("ActorTranslation recognizes already translated items through Babele flags", () => {
  let lookupName = null;
  const actor = actorWithItems([
    {
      _id: "item-1",
      name: "Spada",
      type: "weapon",
      flags: {
        babele: {
          hasTranslation: true,
          translated: true,
          originalName: "Sword",
        },
      },
    },
  ]);

  const actorTranslation = new ActorTranslation({
    translatedPackFor(documentType, data) {
      lookupName = data.name;
      if (documentType !== "Item" || data.name !== "Sword") {
        return null;
      }

      return {
        metadata: {
          label: "Translated Items",
        },
        translate(source) {
          return {...source, name: "Spada"};
        },
      };
    },
  });

  const proposal = actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.equal(lookupName, "Sword");
  assert.deepEqual(proposal.summary(), {
    total: 1,
    ready: 0,
    translated: 1,
    untranslated: 0,
  });
  assert.equal(entry.name(), "Sword");
  assert.equal(entry.proposedName(), "Spada");
  assert.equal(entry.hasTranslation(), true);
  assert.equal(entry.alreadyTranslated, true);
  assert.equal(entry.applicable(), false);
  assert.deepEqual(proposal.updates(), []);
});

test("ActorTranslation recognizes legacy on-demand translated items without Babele flags", () => {
  const actor = actorWithItems([
    {_id: "embedded-item-1", name: "Spada", type: "weapon"},
  ]);
  const translatedPack = {
    translated: true,
    metadata: {
      type: "Item",
      label: "Translated Items",
    },
    translations: {
      Sword: {
        name: "Spada",
      },
    },
  };

  const actorTranslation = new ActorTranslation({
    mappedCompendiums: [translatedPack],
    translatedPackFor() {
      return null;
    },
  });

  const proposal = actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.deepEqual(proposal.summary(), {
    total: 1,
    ready: 0,
    translated: 1,
    untranslated: 0,
  });
  assert.equal(entry.name(), "Sword");
  assert.equal(entry.proposedName(), "Spada");
  assert.equal(entry.packLabel(), "Translated Items");
  assert.equal(entry.hasTranslation(), true);
  assert.equal(entry.alreadyTranslated, true);
  assert.equal(entry.applicable(), false);
  assert.deepEqual(proposal.updates(), []);
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
