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

test("ActorTranslation builds a proposal without applying actor updates", async () => {
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

  const proposal = await actorTranslation.proposal(actor);

  assert.equal(updateCalled, false);
  assert.deepEqual(proposal.summary(), {
    total: 2,
    ready: 1,
    modified: 0,
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

  const proposal = await actorTranslation.proposal(actor);
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

  const proposal = await actorTranslation.proposal(actor);
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

test("ActorTranslation does not apply no-op translations", async () => {
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

  const proposal = await actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.deepEqual(proposal.summary(), {
    total: 1,
    ready: 0,
    modified: 0,
    translated: 1,
    untranslated: 0,
  });
  assert.equal(entry.hasTranslation(), true);
  assert.equal(entry.changed, false);
  assert.equal(entry.applicable(), false);
  assert.deepEqual(proposal.updates(), []);
});

test("ActorTranslation skips imported items changed by the user", async () => {
    const actor = actorWithItems([
      {
        _id: "embedded-feat",
        name: "Weapon Focus (Longsword)",
        type: "feat",
        system: {
          description: {value: "Original description"},
        },
        flags: {
          core: {
            sourceId: "Compendium.test.feats.Item.weapon-focus",
          },
        },
      },
    ]);

    const actorTranslation = new ActorTranslation({
      async sourceDataForUuid() {
        return {
          _id: "weapon-focus",
          name: "Weapon Focus",
          type: "feat",
          system: {
            description: {value: "Original description"},
          },
        };
      },
      mappedCompendiums: [{
        translated: true,
        metadata: {
          type: "Item",
          label: "Translated Feats",
        },
        hasTranslation(data, documentType) {
          return documentType === "Item" && data.name === "Weapon Focus";
        },
        translate() {
          return {
            name: "Arma Focalizzata",
            system: {
              description: {value: "Descrizione tradotta"},
            },
          };
        },
        extract(data) {
          return {
            name: data.name,
            description: data.system?.description?.value,
          };
        },
      }],
    });

    const proposal = await actorTranslation.proposal(actor);
    const [entry] = proposal.entries;

    assert.deepEqual(proposal.summary(), {
      total: 1,
      ready: 0,
      modified: 1,
      translated: 0,
      untranslated: 0,
    });
    assert.equal(entry.hasTranslation(), true);
    assert.equal(entry.userChanged, true);
    assert.equal(entry.applicable(), true);
    assert.equal(entry.proposedName(), "Arma Focalizzata");
    assert.deepEqual(proposal.updates(), [{
      _id: "embedded-feat",
      name: "Arma Focalizzata",
      system: {
        description: {value: "Descrizione tradotta"},
      },
      originalName: "Weapon Focus",
      hasTranslation: true,
      translated: true,
      flags: {
        babele: {
          originalName: "Weapon Focus",
          hasTranslation: true,
          translated: true,
          originalPayload: {
            name: "Weapon Focus",
            description: "Original description",
          },
        },
      },
    }]);
});

test("ActorTranslation marks mapped description changes as modified", async () => {
    const actor = actorWithItems([
      {
        _id: "embedded-feat",
        name: "Weapon Focus",
        type: "feat",
        system: {
          description: {value: "Custom actor description"},
        },
        flags: {
          core: {
            sourceId: "Compendium.test.feats.Item.weapon-focus",
          },
        },
      },
    ]);

    const actorTranslation = new ActorTranslation({
      async sourceDataForUuid() {
        return {
          _id: "weapon-focus",
          name: "Weapon Focus",
          type: "feat",
          system: {
            description: {value: "Original description"},
          },
        };
      },
      mappedCompendiums: [{
        translated: true,
        metadata: {
          type: "Item",
          label: "Translated Feats",
        },
        hasTranslation(data, documentType) {
          return documentType === "Item" && data.flags?.core?.sourceId === "Compendium.test.feats.Item.weapon-focus";
        },
        translate() {
          return {
            name: "Arma Focalizzata",
            system: {
              description: {value: "Descrizione tradotta"},
            },
          };
        },
        extract(data) {
          return {
            name: data.name,
            description: data.system?.description?.value,
          };
        },
      }],
    });

    const proposal = await actorTranslation.proposal(actor);
    const [entry] = proposal.entries;

    assert.equal(entry.userChanged, true);
    assert.deepEqual(proposal.summary(), {
      total: 1,
      ready: 0,
      modified: 1,
      translated: 0,
      untranslated: 0,
    });
});

test("ActorTranslation detects mapped changes against cached translated source data with original flags", async () => {
  const actor = actorWithItems([
    {
      _id: "embedded-feat",
      name: "Weapon Focus",
      type: "feat",
      system: {
        description: {value: "Custom actor description"},
      },
      flags: {
        core: {
          sourceId: "Compendium.test.feats.Item.weapon-focus",
        },
      },
    },
  ]);

  const actorTranslation = new ActorTranslation({
    async sourceDataForUuid(uuid) {
      assert.equal(uuid, "Compendium.test.feats.Item.weapon-focus");
      return {
        name: "Weapon Focus",
        description: "Original description",
        flags: {
          babele: {
            originalPayload: {
              name: "Weapon Focus",
              description: "Original description",
            },
          },
        },
      };
    },
    mappedCompendiums: [{
      translated: true,
      metadata: {
        type: "Item",
        label: "Translated Feats",
      },
      hasTranslation(data, documentType) {
        return documentType === "Item" && data.name === "Weapon Focus";
      },
      translate() {
        return {
          name: "Arma Focalizzata",
          system: {
            description: {value: "Descrizione tradotta"},
          },
        };
      },
      extract(data) {
        return {
          name: data.name,
          description: data.system?.description?.value,
        };
      },
    }],
  });

  const proposal = await actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.equal(entry.userChanged, true);
  assert.deepEqual(proposal.summary(), {
    total: 1,
    ready: 0,
    modified: 1,
    translated: 0,
    untranslated: 0,
  });
});

test("ActorTranslation ignores current originalPayload flags when checking user changes", async () => {
  const actor = actorWithItems([
    {
      _id: "embedded-feat",
      name: "Weapon Focus",
      type: "feat",
      system: {
        description: {value: "Custom actor description"},
      },
      flags: {
        core: {
          sourceId: "Compendium.test.feats.Item.weapon-focus",
        },
        babele: {
          originalPayload: {
            name: "Weapon Focus",
            description: "Original description",
          },
        },
      },
    },
  ]);

  const actorTranslation = new ActorTranslation({
    async sourceDataForUuid() {
      return {
        name: "Weapon Focus",
        description: "Original description",
        flags: {
          babele: {
            originalPayload: {
              name: "Weapon Focus",
              description: "Original description",
            },
          },
        },
      };
    },
    mappedCompendiums: [{
      translated: true,
      metadata: {
        type: "Item",
        label: "Translated Feats",
      },
      hasTranslation(data, documentType) {
        return documentType === "Item" && data.name === "Weapon Focus";
      },
      translate() {
        return {
          name: "Arma Focalizzata",
          system: {
            description: {value: "Descrizione tradotta"},
          },
        };
      },
      extract(data) {
        return {
          name: data.name,
          description: data.system?.description?.value,
        };
      },
    }],
  });

  const proposal = await actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.equal(entry.userChanged, true);
  assert.deepEqual(proposal.summary(), {
    total: 1,
    ready: 0,
    modified: 1,
    translated: 0,
    untranslated: 0,
  });
});

test("ActorTranslation ignores source-only payload paths when checking user changes", async () => {
  const actor = actorWithItems([
    {
      _id: "embedded-feat",
      name: "Weapon Focus",
      type: "feat",
      system: {
        description: {value: "Original description"},
      },
      flags: {
        core: {
          sourceId: "Compendium.test.feats.Item.weapon-focus",
        },
      },
    },
  ]);

  const actorTranslation = new ActorTranslation({
    async sourceDataForUuid() {
      return {
        name: "Weapon Focus",
        description: "Original description",
        flags: {
          babele: {
            originalPayload: {
              name: "Weapon Focus",
              description: "Original description",
              traits: {
                value: ["fighter"],
              },
            },
          },
        },
      };
    },
    mappedCompendiums: [{
      translated: true,
      metadata: {
        type: "Item",
        label: "Translated Feats",
      },
      hasTranslation(data, documentType) {
        return documentType === "Item" && data.name === "Weapon Focus";
      },
      translate() {
        return {
          name: "Arma Focalizzata",
          system: {
            description: {value: "Descrizione tradotta"},
          },
        };
      },
      extract(data) {
        return {
          name: data.name,
          description: data.system?.description?.value,
        };
      },
    }],
  });

  const proposal = await actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.equal(entry.userChanged, false);
  assert.deepEqual(proposal.summary(), {
    total: 1,
    ready: 1,
    modified: 0,
    translated: 0,
    untranslated: 0,
  });
});

test("ActorTranslation detects common payload value changes across different shapes", async () => {
  const actor = actorWithItems([
    {
      _id: "embedded-feat",
      name: "Weapon Focus",
      type: "feat",
      system: {
        description: {value: "Custom actor description"},
      },
      flags: {
        core: {
          sourceId: "Compendium.test.feats.Item.weapon-focus",
        },
      },
    },
  ]);

  const actorTranslation = new ActorTranslation({
    async sourceDataForUuid() {
      return {
        name: "Weapon Focus",
        description: "Original description",
        flags: {
          babele: {
            originalPayload: {
              name: "Weapon Focus",
              description: "Original description",
              traits: {
                value: ["fighter"],
              },
            },
          },
        },
      };
    },
    mappedCompendiums: [{
      translated: true,
      metadata: {
        type: "Item",
        label: "Translated Feats",
      },
      hasTranslation(data, documentType) {
        return documentType === "Item" && data.name === "Weapon Focus";
      },
      translate() {
        return {
          name: "Arma Focalizzata",
          system: {
            description: {value: "Descrizione tradotta"},
          },
        };
      },
      extract(data) {
        return {
          name: data.name,
          description: data.system?.description?.value,
        };
      },
    }],
  });

  const proposal = await actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.equal(entry.userChanged, true);
  assert.deepEqual(proposal.summary(), {
    total: 1,
    ready: 0,
    modified: 1,
    translated: 0,
    untranslated: 0,
  });
});

test("ActorTranslation does not mark imported items as changed for unrelated system differences", async () => {
    const actor = actorWithItems([
      {
        _id: "embedded-rations",
        name: "Rations",
        type: "consumable",
        system: {
          description: {value: "Original description"},
          quantity: 4,
          equipped: false,
        },
        flags: {
          core: {
            sourceId: "Compendium.test.gear.Item.rations",
          },
        },
      },
    ]);

    const actorTranslation = new ActorTranslation({
      async sourceDataForUuid() {
        return {
          _id: "rations",
          name: "Rations",
          type: "consumable",
          system: {
            description: {value: "Original description"},
            quantity: 1,
          },
        };
      },
      mappedCompendiums: [{
        translated: true,
        metadata: {
          type: "Item",
          label: "Translated Gear",
        },
        hasTranslation(data, documentType) {
          return documentType === "Item" && data.flags?.core?.sourceId === "Compendium.test.gear.Item.rations";
        },
        translate() {
          return {
            name: "Razioni",
            system: {
              description: {value: "Descrizione tradotta"},
            },
          };
        },
      }],
    });

    const proposal = await actorTranslation.proposal(actor);
    const [entry] = proposal.entries;

    assert.deepEqual(proposal.summary(), {
      total: 1,
      ready: 1,
      modified: 0,
      translated: 0,
      untranslated: 0,
    });
    assert.equal(entry.userChanged, false);
    assert.equal(entry.applicable(), true);
    assert.equal(entry.proposedName(), "Razioni");
    assert.deepEqual(proposal.updates(), [{
      _id: "embedded-rations",
      name: "Razioni",
      system: {
        description: {value: "Descrizione tradotta"},
      },
      originalName: "Rations",
      hasTranslation: true,
      translated: true,
      flags: {
        babele: {
          originalName: "Rations",
          hasTranslation: true,
          translated: true,
        },
      },
    }]);
});

test("ActorTranslation does not treat Babele-translated source lookup as a user rename", async () => {
    const actor = actorWithItems([
      {
        _id: "embedded-sword",
        name: "Sword",
        type: "weapon",
        flags: {
          core: {
            sourceId: "Compendium.test.weapons.Item.sword",
          },
        },
      },
    ]);

    const actorTranslation = new ActorTranslation({
      async sourceDataForUuid() {
        return {
          _id: "sword",
          name: "Sword",
          type: "weapon",
        };
      },
      mappedCompendiums: [{
        translated: true,
        metadata: {
          type: "Item",
          label: "Translated Weapons",
        },
        hasTranslation(data, documentType) {
          return documentType === "Item" && data.flags?.core?.sourceId === "Compendium.test.weapons.Item.sword";
        },
        translate() {
          return {name: "Spada"};
        },
      }],
    });

    const proposal = await actorTranslation.proposal(actor);
    const [entry] = proposal.entries;

    assert.deepEqual(proposal.summary(), {
      total: 1,
      ready: 1,
      modified: 0,
      translated: 0,
      untranslated: 0,
    });
    assert.equal(entry.userChanged, false);
    assert.equal(entry.applicable(), true);
    assert.equal(entry.proposedName(), "Spada");
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

test("ActorTranslation recognizes already translated items through Babele flags", async () => {
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

  const proposal = await actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.equal(lookupName, "Sword");
  assert.deepEqual(proposal.summary(), {
    total: 1,
    ready: 0,
    modified: 0,
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

test("ActorTranslation recognizes legacy on-demand translated items without Babele flags", async () => {
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

  const proposal = await actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.deepEqual(proposal.summary(), {
    total: 1,
    ready: 0,
    modified: 0,
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

  const proposal = await actorTranslation.proposal(actor);
  const updates = await actorTranslation.apply(proposal);

  assert.deepEqual(updates, []);
  assert.equal(updateCalled, false);
});
