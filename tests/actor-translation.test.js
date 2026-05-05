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

test("ActorTranslation does not mark imported items as modified for mapped fields untouched by the translation", async () => {
  const actor = actorWithItems([
    {
      _id: "embedded-bite",
      name: "Bear Bite",
      type: "feat",
      system: {
        description: {value: "Original description"},
        activation: {condition: "actor-imported"},
      },
      flags: {
        core: {
          sourceId: "Compendium.test.feats.Item.bear-bite",
        },
      },
    },
  ]);

  const actorTranslation = new ActorTranslation({
    async sourceDataForUuid() {
      return {
        _id: "bear-bite",
        name: "Bear Bite",
        type: "feat",
        system: {
          description: {value: "Original description"},
          activation: {condition: "compendium-default"},
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
        return documentType === "Item" && data.flags?.core?.sourceId === "Compendium.test.feats.Item.bear-bite";
      },
      translate() {
        return {
          name: "Morsure d'ours",
        };
      },
      extract(data) {
        return {
          name: data.name,
          description: data.system?.description?.value,
          activationCondition: data.system?.activation?.condition,
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

test("ActorTranslation ignores import-time HTML normalization when checking user changes", async () => {
  const actor = actorWithItems([
    {
      _id: "embedded-cleric",
      name: "Cleric",
      type: "class",
      system: {
        description: {
          value: "<p>Line one<br>Line two.</p><p>Use cover and Fireball.</p>",
        },
      },
      flags: {
        core: {
          sourceId: "Compendium.test.classes.Item.cleric",
        },
      },
    },
  ]);

  const actorTranslation = new ActorTranslation({
    async sourceDataForUuid() {
      return {
        _id: "cleric",
        name: "Cleric",
        type: "class",
        system: {
          description: {
            value: "<p>Line one<br />Line two.</p><p>Use &amp;reference[cover] and @UUID[Compendium.test.spells.Item.fireball]{Fireball}.</p>",
          },
        },
      };
    },
    mappedCompendiums: [{
      translated: true,
      metadata: {
        type: "Item",
        collection: "test.classes",
        label: "Translated Classes",
      },
      hasTranslation(data, documentType) {
        return documentType === "Item" && data.flags?.core?.sourceId === "Compendium.test.classes.Item.cleric";
      },
      translate() {
        return {
          name: "Clerc",
          system: {
            description: {
              value: "<p>Ligne un<br>Ligne deux.</p>",
            },
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
  assert.equal(entry.proposedName(), "Clerc");
});

test("ActorTranslation ignores spell-description normalization differences when checking user changes", async () => {
  const actor = actorWithItems([
    {
      _id: "embedded-command",
      name: "Command",
      type: "spell",
      system: {
        description: {
          value: "<p><strong>Higher Levels.</strong> When you cast this spell, the target falls prone and can't be charmed or frightened.</p>",
        },
      },
      flags: {
        core: {
          sourceId: "Compendium.test.spells.Item.command",
        },
      },
    },
  ]);

  const actorTranslation = new ActorTranslation({
    async sourceDataForUuid() {
      return {
        _id: "command",
        name: "Command",
        type: "spell",
        system: {
          description: {
            value: "<p><strong>At Higher Levels.</strong> When you cast this spell, the target falls &amp;reference[prone] and can't be &amp;reference[charmed apply=false] or &amp;reference[frightened apply=false].</p>",
          },
        },
      };
    },
    mappedCompendiums: [{
      translated: true,
      metadata: {
        type: "Item",
        collection: "test.spells",
        label: "Translated Spells",
      },
      hasTranslation(data, documentType) {
        return documentType === "Item" && data.flags?.core?.sourceId === "Compendium.test.spells.Item.command";
      },
      translate() {
        return {
          name: "Injonction",
          system: {
            description: {
              value: "<p>Description traduite</p>",
            },
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
  assert.equal(entry.proposedName(), "Injonction");
});

test("ActorTranslation prefers exact candidates from the source compendium collection", async () => {
  const actor = actorWithItems([
    {
      _id: "embedded-command",
      name: "Command",
      type: "spell",
      flags: {
        core: {
          sourceId: "Compendium.test.spells.Item.command",
        },
      },
    },
  ]);

  const actorTranslation = new ActorTranslation({
    async sourceDataForUuid() {
      return {
        _id: "command",
        name: "Command",
        type: "spell",
      };
    },
    mappedCompendiums: [
      {
        translated: true,
        metadata: {
          type: "Item",
          collection: "test.spells",
          label: "Spells 2014",
        },
        hasTranslation(data, documentType) {
          return documentType === "Item" && data.name === "Command";
        },
        translate() {
          return {name: "Ordre"};
        },
      },
      {
        translated: true,
        metadata: {
          type: "Item",
          collection: "test.spells24",
          label: "Spells 2024",
        },
        hasTranslation(data, documentType) {
          return documentType === "Item" && data.name === "Command";
        },
        translate() {
          return {name: "Injonction"};
        },
      },
    ],
  });

  const proposal = await actorTranslation.proposal(actor);
  const [entry] = proposal.entries;

  assert.equal(entry.candidates.length, 1);
  assert.equal(entry.candidates[0].pack.metadata.collection, "test.spells");
  assert.equal(entry.proposedName(), "Ordre");
});

test("ActorTranslation proposes fuzzy translation candidates for missing entries", async () => {
  const actor = actorWithItems([
    {
      _id: "embedded-bite",
      name: "Bear Bite",
      type: "feat",
    },
  ]);

  const actorTranslation = new ActorTranslation({
    mappedCompendiums: [{
      translated: true,
      metadata: {
        type: "Item",
        collection: "test.feats",
        label: "Translated Feats",
      },
      translations: {
        Bite: {
          name: "Morsure",
        },
      },
      hasTranslation(data, documentType) {
        return documentType === "Item" && data.name === "Bite";
      },
      translate(data) {
        return this.translations[data.name] ?? {};
      },
    }],
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
    translated: 0,
    untranslated: 1,
  });
  assert.equal(entry.proposedName(), "Morsure");
  assert.equal(entry.candidates.length, 1);
  assert.equal(entry.candidates[0].suggested, true);
  assert.equal(entry.reviewRequired(), true);
});

test("ActorTranslation proposes fuzzy translation candidates from translationEntries", async () => {
  const actor = actorWithItems([
    {
      _id: "embedded-bite",
      name: "Bear Bite",
      type: "feat",
    },
  ]);

  const actorTranslation = new ActorTranslation({
    mappedCompendiums: [{
      translated: true,
      metadata: {
        type: "Item",
        collection: "test.feats",
        label: "Translated Feats",
      },
      translationEntries: {
        entries() {
          return [["Bite", {name: "Morsure"}]];
        },
      },
      hasTranslation(data, documentType) {
        return documentType === "Item" && data.name === "Bite";
      },
      translate(data) {
        return data.name === "Bite" ? {name: "Morsure"} : {};
      },
    }],
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
    translated: 0,
    untranslated: 1,
  });
  assert.equal(entry.proposedName(), "Morsure");
  assert.equal(entry.candidates.length, 1);
  assert.equal(entry.candidates[0].suggested, true);
  assert.equal(entry.reviewRequired(), true);
});

test("ActorTranslation marks exact same-name duplicates in the source pack as review-required", async () => {
  const actor = actorWithItems([
    {
      _id: "embedded-spellcasting",
      name: "Spellcasting",
      type: "feat",
      flags: {
        core: {
          sourceId: "Compendium.dnd5e.classfeatures.Item.cleric-spellcasting",
        },
      },
    },
  ]);

  game.packs.set("dnd5e.classfeatures", {
    index: [
      {_id: "cleric-spellcasting", name: "Spellcasting", type: "feat"},
      {_id: "wizard-spellcasting", name: "Spellcasting", type: "feat"},
    ],
    async getDocument(id) {
      const source = id === "cleric-spellcasting"
        ? {
            _id: "cleric-spellcasting",
            name: "Spellcasting",
            type: "feat",
            system: {
              requirements: "Cleric 1",
            },
          }
        : {
            _id: "wizard-spellcasting",
            name: "Spellcasting",
            type: "feat",
            system: {
              requirements: "Wizard 1",
            },
          };

      return {
        toObject() {
          return {...source};
        },
      };
    },
  });

  const translations = {
    "cleric-spellcasting": {name: "Sorts", system: {requirements: "Clerc 1"}},
    "wizard-spellcasting": {name: "Sorts", system: {requirements: "Magicien 1"}},
  };
  const actorTranslation = new ActorTranslation({
    async sourceDataForUuid(uuid) {
      const id = String(uuid).split(".").pop();
      if (id === "cleric-spellcasting") {
        return {
          _id: "cleric-spellcasting",
          name: "Spellcasting",
          type: "feat",
          flags: {
            core: {
              sourceId: "Compendium.dnd5e.classfeatures.Item.cleric-spellcasting",
            },
          },
          system: {
            requirements: "Cleric 1",
          },
        };
      }

      if (id === "wizard-spellcasting") {
        return {
          _id: "wizard-spellcasting",
          name: "Spellcasting",
          type: "feat",
          flags: {
            core: {
              sourceId: "Compendium.dnd5e.classfeatures.Item.wizard-spellcasting",
            },
          },
          system: {
            requirements: "Wizard 1",
          },
        };
      }

      return null;
    },
    translatedPacks() {
      return [{
        translated: true,
        metadata: {
          type: "Item",
          collection: "dnd5e.classfeatures",
          label: "Class Features",
        },
        hasTranslation(data, documentType) {
          return documentType === "Item" && data.name === "Spellcasting";
        },
        translate(data) {
          return translations[data._id] ?? {};
        },
      }];
    },
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
    translated: 0,
    untranslated: 1,
  });
  assert.equal(entry.reviewRequired(), true);
  assert.equal(entry.proposedName(), "Sorts");
  assert.deepEqual(entry.candidates.map((candidate) => ({
    proposedName: candidate.proposedName(),
    label: candidate.optionLabel(),
    reviewRequired: candidate.reviewRequired(),
    reason: candidate.reviewReason,
  })), [
    {
      proposedName: "Sorts",
      label: "Class Features · Cleric 1",
      reviewRequired: true,
      reason: "ambiguous-exact",
    },
    {
      proposedName: "Sorts",
      label: "Class Features · Wizard 1",
      reviewRequired: true,
      reason: "ambiguous-exact",
    },
  ]);
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
  assert.equal(entry.applicable(), true);
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

test("ActorTranslation supports rollback mode for already translated items", async () => {
  const actor = actorWithItems([
    {
      _id: "item-1",
      name: "Spada",
      type: "weapon",
      flags: {
        core: {
          sourceId: "Compendium.test.items.Item.sword",
        },
        babele: {
          hasTranslation: true,
          translated: true,
          originalName: "Sword",
          originalPayload: {
            name: "Sword",
          },
        },
      },
    },
  ]);

  const actorTranslation = new ActorTranslation({
    translatedPackFor(documentType, data) {
      if (documentType !== "Item" || data.name !== "Sword") {
        return null;
      }

      return {
        metadata: {
          collection: "test.items",
          label: "Translated Items",
        },
        translate() {
          return {name: "Lama"};
        },
      };
    },
    rollbackDocument(_documentType, source) {
      return {
        ...source,
        name: "Sword",
        flags: {
          core: source.flags?.core ?? {},
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
  assert.equal(entry.alreadyTranslated, true);
  assert.deepEqual(entry.modeChoices(), ["retranslate", "rollback"]);
  assert.equal(entry.currentMode, "retranslate");
  assert.equal(entry.applicable(), true);
  assert.equal(entry.proposedName(), "Lama");

  assert.equal(entry.selectMode("rollback"), true);
  assert.equal(entry.rollbackMode(), true);
  assert.equal(entry.applicable(), true);
  assert.equal(entry.rollbackName(), "Sword");
  assert.deepEqual(entry.update, {
    _id: "item-1",
    name: "Sword",
    type: "weapon",
    flags: {
      core: {
        sourceId: "Compendium.test.items.Item.sword",
      },
    },
    "-=originalName": null,
    "-=hasTranslation": null,
    "-=translated": null,
    "flags.babele.-=originalName": null,
    "flags.babele.-=hasTranslation": null,
    "flags.babele.-=translated": null,
    "flags.babele.-=originalPayload": null,
    "flags.babele.-=lang": null,
    "flags.-=babele": null,
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

  const proposal = await actorTranslation.proposal(actor);
  const updates = await actorTranslation.apply(proposal);

  assert.deepEqual(updates, []);
  assert.equal(updateCalled, false);
});
