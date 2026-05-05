import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {DocumentMapping} = await import("../module/script/mapping/document-mapping.js");
const {DocumentMappings} = await import("../module/script/mapping/document-mappings.js");
const {IdentityExtractorRegistry} = await import("../module/script/identity/identity-extractor-registry.js");
const {ConverterRegistry} = await import("../module/script/converter/converter-registry.js");
const {default: Babel} = await import("../module/script/babele.js");

function identityExtractors() {
  return new IdentityExtractorRegistry(IdentityExtractorRegistry.defaultExtractors());
}

function converterRegistry() {
  return new ConverterRegistry();
}

test("DocumentMapping is the canonical mapping model", () => {
  const mapping = new DocumentMapping("Item", {}, {
    identityExtractors: identityExtractors(),
    converterRegistry: converterRegistry(),
  });

  assert.equal(mapping instanceof DocumentMapping, true);
  assert.equal(mapping.usesConverters(), false);
});

test("DocumentMapping exposes default identity candidates for generic documents", () => {
  const mapping = new DocumentMapping("Item", {}, {
    identityExtractors: identityExtractors(),
    converterRegistry: converterRegistry(),
  });
  const document = {
    _id: "item-1",
    id: "item-id-1",
    name: "Longsword",
    flags: {
      core: {
        sourceId: "Compendium.test.items.source-1",
      },
    },
  };

  assert.deepEqual(mapping.exportKeyCandidates(document), ["Longsword", "item-1", "item-id-1"]);
  assert.deepEqual(mapping.matchKeyCandidates(document), ["item-1", "Longsword", "source-1"]);
});

test("DocumentMapping resolves registered identity extractors from the provided registry", () => {
  const registry = identityExtractors();
  registry.register("range", (document) => {
    const [start, end] = document?.range ?? [];
    return Number.isInteger(start) && Number.isInteger(end) ? `${start}-${end}` : null;
  });

  const mapping = new DocumentMapping("TableResult", {
    _identity: {
      export: ["range", "_id"],
      match: ["_id", "range"],
    },
    description: "description",
  }, {
    identityExtractors: registry,
    converterRegistry: converterRegistry(),
  });
  const document = {
    _id: "result-1",
    range: [2, 3],
    description: "<p>Wolf</p>",
  };

  assert.deepEqual(mapping.exportKeyCandidates(document), ["2-3", "result-1"]);
  assert.deepEqual(mapping.matchKeyCandidates(document), ["result-1", "2-3"]);
});

test("DocumentMapping uses the default TableResult range identity when Babele registers it", () => {
  game.babele = new Babel();

  const mapping = game.babele.documentMappings.mappingFor("TableResult");
  const document = {
    _id: "result-1",
    range: [2, 3],
    description: "<p>Wolf</p>",
  };

  assert.deepEqual(mapping.exportKeyCandidates(document), ["2-3", "result-1"]);
  assert.deepEqual(mapping.matchKeyCandidates(document), ["result-1", "2-3"]);
});

test("DocumentMapping resolves TableResult.name through the referenced document field fallback", () => {
  game.babele = new Babel();
  game.babele.translateField = (field, pack, data) => {
    assert.equal(field, "name");
    assert.equal(pack, "Compendium.test.items.Item.item-1");
    assert.deepEqual(data, {name: "Charging Quiver"});
    return "Заряжающий Колчан";
  };

  const mapping = game.babele.documentMappings.mappingFor("TableResult");
  const translated = mapping.translateField("name", {
    _id: "result-1",
    name: "Charging Quiver",
    documentUuid: "Compendium.test.items.Item.item-1",
  }, {});

  assert.equal(translated, "Заряжающий Колчан");
});

test("DocumentMapping applies conditional mapping variants as additional field layers", () => {
  const mapping = new DocumentMapping("Item", {
    name: "name",
    _variants: [{
      _when: {path: "type", equals: "weapon"},
      damage: "system.damage",
    }],
  }, {
    identityExtractors: identityExtractors(),
    converterRegistry: converterRegistry(),
  });

  const weapon = {
    _id: "weapon-1",
    type: "weapon",
    name: "Longsword",
    system: {
      damage: "1d8 slashing",
    },
  };
  const spell = {
    _id: "spell-1",
    type: "spell",
    name: "Fire Bolt",
    system: {
      damage: "1d10 fire",
    },
  };

  assert.deepEqual(mapping.map(weapon, {
    name: "Spada lunga",
    damage: "1d8 taglienti",
  }), {
    name: "Spada lunga",
    system: {
      damage: "1d8 taglienti",
    },
  });
  assert.deepEqual(mapping.map(spell, {
    name: "Dardo di fuoco",
    damage: "1d10 fuoco",
  }), {
    name: "Dardo di fuoco",
  });
  assert.deepEqual(mapping.extract(weapon), {
    name: "Longsword",
    damage: "1d8 slashing",
  });
  assert.deepEqual(mapping.extract(spell), {
    name: "Fire Bolt",
  });
});

test("DocumentMapping variants can override base field definitions when their condition matches", () => {
  const mapping = new DocumentMapping("Item", {
    label: "name",
    _variants: [{
      _when: {
        all: [
          {path: "type", equals: "spell"},
          {path: "system.school", in: ["evo", "abj"]},
        ],
      },
      label: "system.localizedName",
    }],
  }, {
    identityExtractors: identityExtractors(),
    converterRegistry: converterRegistry(),
  });

  const spell = {
    type: "spell",
    name: "Fire Bolt",
    system: {
      school: "evo",
      localizedName: "Fire Bolt Display",
    },
  };
  const weapon = {
    type: "weapon",
    name: "Longsword",
    system: {
      localizedName: "Ignored",
    },
  };

  assert.deepEqual(mapping.map(spell, {label: "Dardo di fuoco"}), {
    system: {
      localizedName: "Dardo di fuoco",
    },
  });
  assert.deepEqual(mapping.map(weapon, {label: "Spada lunga"}), {
    name: "Spada lunga",
  });
});

test("DocumentMapping variants support any and exists conditions", () => {
  const mapping = new DocumentMapping("Item", {
    name: "name",
    _variants: [{
      _when: {
        any: [
          {path: "system.uses.label", exists: true},
          {path: "type", equals: "consumable"},
        ],
      },
      uses: "system.uses.label",
    }],
  }, {
    identityExtractors: identityExtractors(),
    converterRegistry: converterRegistry(),
  });

  const limitedUseItem = {
    type: "feat",
    name: "Second Wind",
    system: {
      uses: {
        label: "Uses",
      },
    },
  };
  const passiveItem = {
    type: "feat",
    name: "Fighting Style",
    system: {},
  };

  assert.deepEqual(mapping.map(limitedUseItem, {
    name: "Recuperare energie",
    uses: "Utilizzi",
  }), {
    name: "Recuperare energie",
    system: {
      uses: {
        label: "Utilizzi",
      },
    },
  });
  assert.deepEqual(mapping.map(passiveItem, {
    name: "Stile di combattimento",
    uses: "Utilizzi",
  }), {
    name: "Stile di combattimento",
  });
});

test("DocumentMappings provides a conservative default mapping for ActiveEffect", () => {
  game.babele = new Babel();

  const mapping = game.babele.documentMappings.mappingFor("ActiveEffect");
  const document = {
    _id: "effect-1",
    name: "Blessed",
    description: "<p>Add 1d4 to attack rolls and saving throws.</p>",
    statuses: ["blessed"],
    duration: {
      value: 10,
      units: "rounds",
    },
    changes: [{
      key: "system.bonuses.mwak.attack",
      type: "add",
      value: "1d4",
    }],
  };

  assert.deepEqual(mapping.extract(document), {
    name: "Blessed",
    description: "<p>Add 1d4 to attack rolls and saving throws.</p>",
    changes: {
      "system.bonuses.mwak.attack": "1d4",
    },
  });
});

test("DocumentMappings.supports reflects the effective mapping registry", () => {
  game.babele = new Babel();

  assert.equal(game.babele.documentMappings.supports("Item"), true);
  assert.equal(game.babele.documentMappings.supports("ActiveEffect"), true);
  assert.equal(game.babele.documentMappings.supports("Item.weapon"), false);
  assert.equal(game.babele.documentMappings.supports("ChatMessage"), false);
});

test("DocumentMapping.extract omits lookup-backed fields because they do not export translation payload", () => {
  const babele = new Babel();
  const mapping = new DocumentMapping("Item", {
    name: "name",
    rarityLabel: {
      path: "system.rarity",
      converter: "lookup",
      values: {
        Common: "Comune",
      },
    },
  }, {
    identityExtractors: identityExtractors(),
    converterRegistry: babele.converterRegistry,
  });
  const data = {
    _id: "item-1",
    name: "Longsword",
    system: {
      rarity: "Common",
    },
  };

  assert.deepEqual(mapping.extract(data), {
    name: "Longsword",
  });
});

test("DocumentMapping.extract omits tokenizedLookup-backed fields because they do not export translation payload", () => {
  const babele = new Babel();
  const mapping = new DocumentMapping("Actor", {
    name: "name",
    languages: {
      path: "system.traits.languages.custom",
      converter: "tokenizedLookup",
      delimiter: "; ",
      normalize: "trim-lowercase",
      values: {
        common: "Comune",
        draconic: "Draconico",
      },
    },
  }, {
    identityExtractors: identityExtractors(),
    converterRegistry: babele.converterRegistry,
  });
  const data = {
    _id: "actor-1",
    name: "Cultist",
    system: {
      traits: {
        languages: {
          custom: "Common; Draconic",
        },
      },
    },
  };

  assert.deepEqual(mapping.extract(data), {
    name: "Cultist",
  });
});

test("DocumentMappings resolves legacy subtype mappings through variants", () => {
  const layered = new DocumentMappings({
    Item: {
      description: "system.description.value",
    },
  }, {
    registeredMappings: [{
      Item: {
        source: "system.source",
      },
    }],
    loadedMappings: [{
      "Item.weapon": {
        damage: "system.damage.value",
      },
    }],
    identityExtractors: identityExtractors(),
    converterRegistry: converterRegistry(),
  });

  const weaponMapping = layered.mappingFor("Item", {
    rarity: "system.rarity",
  });

  assert.equal(weaponMapping instanceof DocumentMapping, true);
  assert.equal(layered.current()["Item.weapon"], undefined);
  assert.equal(Array.isArray(layered.current().Item._variants), true);

  assert.equal(weaponMapping.extractField("description", {
    type: "weapon",
    system: {
      description: {value: "Sharp blade"},
      source: "SRD",
      damage: {value: "1d8"},
      rarity: "common",
    },
  }), "Sharp blade");
  assert.equal(weaponMapping.extractField("source", {
    type: "weapon",
    system: {
      source: "SRD",
    },
  }), "SRD");
  assert.equal(weaponMapping.extractField("damage", {
    type: "weapon",
    system: {
      damage: {value: "1d8"},
    },
  }), "1d8");
  assert.equal(weaponMapping.extractField("rarity", {
    type: "weapon",
    system: {
      rarity: "common",
    },
  }), "common");
});

test("DocumentMappings materializes document mappings from effective loaded layers", () => {
  const layered = new DocumentMappings({
    Item: {
      description: "system.description.value",
    },
  }, {
    registeredMappings: [{
      Item: {
        source: "system.source",
      },
    }],
    loadedMappings: [{
      "Item.weapon": {
        damage: "system.damage.value",
      },
    }],
    identityExtractors: identityExtractors(),
    converterRegistry: converterRegistry(),
  });

  const mapping = layered.mappingFor("Item", {
    rarity: "system.rarity",
  });

  assert.equal(mapping.extractField("description", {
    type: "weapon",
    system: {
      description: {value: "Sharp blade"},
      source: "SRD",
      damage: {value: "1d8"},
      rarity: "common",
    },
  }), "Sharp blade");
  assert.equal(mapping.extractField("source", {
    type: "weapon",
    system: {
      source: "SRD",
    },
  }), "SRD");
  assert.equal(mapping.extractField("damage", {
    type: "weapon",
    system: {
      damage: {value: "1d8"},
    },
  }), "1d8");
  assert.equal(mapping.extractField("rarity", {
    type: "weapon",
    system: {
      rarity: "common",
    },
  }), "common");
});

test("DocumentMappings exposes inspectable effective mapping precedence", () => {
  const layered = new DocumentMappings({
    Item: {
      description: "system.description.value",
    },
    "Item.weapon": {
      damage: "system.damage.value",
    },
  }, {
    registeredMappings: [{
      Item: {
        source: "system.source",
      },
    }],
    loadedMappings: [{
      Item: {
        description: "system.loadedDescription.value",
      },
      "Item.weapon": {
        damage: "system.loadedDamage.value",
      },
    }],
    identityExtractors: identityExtractors(),
    converterRegistry: converterRegistry(),
  });

  const report = layered.inspect("Item", {
    data: {type: "weapon"},
    customMapping: {
      rarity: "system.rarity",
      "Item.weapon": {
        critical: "system.critical",
      },
    },
  });

  assert.equal(report.documentType, "Item");
  assert.equal(report.subtype, "weapon");
  assert.deepEqual(report.keys, {
    base: "Item",
    subtype: "Item.weapon",
  });
  assert.deepEqual(
    report.layers.map((layer) => `${layer.kind}:${layer.branch}:${layer.key}`),
    [
      "built-in:base:Item",
      "built-in:subtype:Item.weapon",
      "registered:base:Item",
      "loaded:base:Item",
      "loaded:subtype:Item.weapon",
      "compendium-local:base:Item",
      "compendium-local:subtype:Item.weapon",
    ],
  );
  assert.deepEqual(report.effective.mapping, {
    description: "system.loadedDescription.value",
    source: "system.source",
    rarity: "system.rarity",
    _variants: [
      {
        _when: {path: "type", equals: "weapon"},
        damage: "system.damage.value",
      },
      {
        _when: {path: "type", equals: "weapon"},
        damage: "system.loadedDamage.value",
      },
      {
        _when: {path: "type", equals: "weapon"},
        critical: "system.critical",
      },
    ],
  });
});

test("DocumentMappings diagnostic layers are detached from runtime state", () => {
  const mappings = new DocumentMappings({
    Item: {
      name: "name",
    },
  }, {
    identityExtractors: identityExtractors(),
    converterRegistry: converterRegistry(),
  });

  const [builtIn] = mappings.layers();
  builtIn.mapping.Item.name = "mutated";

  assert.equal(mappings.current().Item.name, "name");
});

test("Babel exposes effective mapping inspection through the public facade", () => {
  const babele = new Babel();
  babele.registerMapping({
    Item: {
      source: "system.source",
    },
  });

  const report = babele.inspectMapping("Item");

  assert.equal(report.documentType, "Item");
  assert.equal(report.layers.some((layer) => layer.kind === "registered"), true);
  assert.equal(report.effective.mapping.source, "system.source");
});
