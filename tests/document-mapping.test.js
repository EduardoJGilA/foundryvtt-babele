import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {DocumentMapping} = await import("../module/script/mapping/document-mapping.js");
const {DocumentMappings} = await import("../module/script/mapping/document-mappings.js");
const {DocumentMappingHierarchy} = await import("../module/script/mapping/document-mapping-hierarchy.js");
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

  const mapping = game.babele.documentMappings.hierarchyFor("TableResult").mappingFor();
  const document = {
    _id: "result-1",
    range: [2, 3],
    description: "<p>Wolf</p>",
  };

  assert.deepEqual(mapping.exportKeyCandidates(document), ["2-3", "result-1"]);
  assert.deepEqual(mapping.matchKeyCandidates(document), ["result-1", "2-3"]);
});

test("DocumentMappings provides a conservative default mapping for ActiveEffect", () => {
  game.babele = new Babel();

  const mapping = game.babele.documentMappings.hierarchyFor("ActiveEffect").mappingFor();
  const document = {
    _id: "effect-1",
    name: "Blessed",
    description: "<p>Add 1d4 to attack rolls and saving throws.</p>",
    statuses: ["blessed"],
    duration: {
      value: 10,
      units: "rounds",
    },
    system: {
      changes: [{
        key: "system.bonuses.mwak.attack",
        type: "add",
        value: "1d4",
      }],
    },
  };

  assert.deepEqual(mapping.extract(document), {
    name: "Blessed",
    description: "<p>Add 1d4 to attack rolls and saving throws.</p>",
  });
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

test("DocumentMappingHierarchy resolves subtype mappings as an inheritance-like hierarchy", () => {
  const mappings = new DocumentMappings({
    Item: {
      description: "system.description.value",
    },
  }, {
    identityExtractors: identityExtractors(),
    converterRegistry: converterRegistry(),
  });

  const registered = mappings.withRegistered({
    Item: {
      source: "system.source",
    },
  });
  const layered = registered.withLoaded([{
    "Item.weapon": {
      damage: "system.damage.value",
    },
  }]);

  const hierarchy = layered.hierarchyFor("Item", {
    rarity: "system.rarity",
  });

  assert.equal(hierarchy instanceof DocumentMappingHierarchy, true);
  assert.equal(hierarchy.base() instanceof DocumentMapping, true);
  const weaponMapping = hierarchy.mappingFor({
    type: "weapon",
  });

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
  const mappings = new DocumentMappings({
    Item: {
      description: "system.description.value",
    },
  }, {
    identityExtractors: identityExtractors(),
    converterRegistry: converterRegistry(),
  });

  const registered = mappings.withRegistered({
    Item: {
      source: "system.source",
    },
  });
  const layered = registered.withLoaded([{
    "Item.weapon": {
      damage: "system.damage.value",
    },
  }]);

  const mapping = layered.hierarchyFor("Item", {
    rarity: "system.rarity",
  }).mappingFor({
    type: "weapon",
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
