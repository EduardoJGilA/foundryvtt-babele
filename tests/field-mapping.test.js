import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {FieldMapping} = await import("../module/script/mapping/field-mapping.js");
const {ConverterRegistry} = await import("../module/script/converter/converter-registry.js");

test("FieldMapping.map preserves empty string translations", () => {
  const mapping = new FieldMapping("description", "system.description.value", null);
  const data = {
    system: {
      description: {
        value: "Original description",
      },
    },
  };

  assert.deepEqual(mapping.map(data, {description: ""}), {
    system: {
      description: {
        value: "",
      },
    },
  });
});

test("FieldMapping.map preserves zero and false translations", () => {
  const zeroMapping = new FieldMapping("weight", "system.weight", null);
  const falseMapping = new FieldMapping("identified", "system.identified", null);
  const data = {
    system: {
      weight: 12,
      identified: true,
    },
  };

  assert.deepEqual(zeroMapping.map(data, {weight: 0}), {
    system: {
      weight: 0,
    },
  });
  assert.deepEqual(falseMapping.map(data, {identified: false}), {
    system: {
      identified: false,
    },
  });
});

test("FieldMapping.map still skips undefined and null translations", () => {
  const mapping = new FieldMapping("description", "system.description.value", null);
  const data = {
    system: {
      description: {
        value: "Original description",
      },
    },
  };

  assert.deepEqual(mapping.map(data, {description: undefined}), {});
  assert.deepEqual(mapping.map(data, {description: null}), {});
});

test("FieldMapping.map warns and fails open when the mapped path does not exist", () => {
  const mapping = new FieldMapping("description", "system.description.value", null);
  const data = {
    _id: "item-missing-path",
    name: "Broken item",
    system: {},
  };
  const originalGet = game.settings.get;
  const originalWarn = console.warn;
  let warningCalls = 0;

  game.settings.get = (namespace, key) => namespace === "babele" && key === "warnMissingPaths";
  console.warn = () => {
    warningCalls += 1;
  };

  try {
    assert.deepEqual(mapping.map(data, {description: "Translated description"}), {});
    assert.equal(warningCalls, 1);
  } finally {
    game.settings.get = originalGet;
    console.warn = originalWarn;
  }
});

test("FieldMapping.map silently skips missing paths when no static translation is provided", () => {
  const mapping = new FieldMapping("description", "system.description.value", null);
  const data = {
    _id: "item-no-translation",
    name: "Untranslated item",
    system: {},
  };

  assert.deepEqual(mapping.map(data, {}), {});
});

test("FieldMapping.map silently skips missing paths when diagnostics are disabled", () => {
  const mapping = new FieldMapping("description", "system.description.value", null);
  const data = {
    _id: "item-missing-path-disabled",
    name: "Quiet item",
    system: {},
  };
  const originalGet = game.settings.get;
  const originalWarn = console.warn;
  let warningCalls = 0;

  game.settings.get = () => false;
  console.warn = () => {
    warningCalls += 1;
  };

  try {
    assert.deepEqual(mapping.map(data, {description: "Translated description"}), {});
    assert.equal(warningCalls, 0);
  } finally {
    game.settings.get = originalGet;
    console.warn = originalWarn;
  }
});

test("FieldMapping.map skips object payloads for static fields", () => {
  const mapping = new FieldMapping("description", "system.description.value", null);
  const data = {
    _id: "item-1",
    name: "Sword",
    system: {
      description: {
        value: "Original description",
      },
    },
  };

  assert.deepEqual(mapping.map(data, {
    description: {
      value: "Translated description",
    },
  }), {});
  assert.equal(data.system.description.value, "Original description");
});

test("FieldMapping.map skips array payloads for static fields", () => {
  const mapping = new FieldMapping("description", "system.description.value", null);
  const data = {
    _id: "item-2",
    name: "Shield",
    system: {
      description: {
        value: "Original description",
      },
    },
  };

  assert.deepEqual(mapping.map(data, {
    description: ["Translated description"],
  }), {});
  assert.equal(data.system.description.value, "Original description");
});

test("FieldMapping.map skips primitive type mismatches for static fields", () => {
  const stringMapping = new FieldMapping("description", "system.description.value", null);
  const numberMapping = new FieldMapping("weight", "system.weight", null);
  const booleanMapping = new FieldMapping("identified", "system.identified", null);
  const data = {
    _id: "item-3",
    name: "Armor",
    system: {
      description: {
        value: "Original description",
      },
      weight: 12,
      identified: true,
    },
  };

  assert.deepEqual(stringMapping.map(data, {description: 42}), {});
  assert.deepEqual(numberMapping.map(data, {weight: "heavy"}), {});
  assert.deepEqual(booleanMapping.map(data, {identified: "yes"}), {});

  assert.equal(data.system.description.value, "Original description");
  assert.equal(data.system.weight, 12);
  assert.equal(data.system.identified, true);
});

test("FieldMapping.map fails open when a dynamic field references a missing converter", () => {
  const registry = new ConverterRegistry();
  const mapping = new FieldMapping("advancement", {
    path: "system.advancement",
    converter: "advancement",
  }, registry);
  const data = {
    _id: "class-1",
    name: "Barbarian",
    system: {
      advancement: [
        {_id: "adv-1", title: "Rage"},
      ],
    },
  };
  const translations = {
    advancement: {
      "adv-1": {
        title: "Ira",
      },
    },
  };

  assert.deepEqual(mapping.map(data, translations), {});
  assert.deepEqual(data.system.advancement, [
    {_id: "adv-1", title: "Rage"},
  ]);
});

test("FieldMapping.map logs converter failure diagnostics with source value shape", () => {
  const originalError = console.error;
  const errorCalls = [];
  console.error = (...args) => errorCalls.push(args);

  try {
    const registry = new ConverterRegistry({
      failingObjectConverter(value) {
        value.forEach(() => {});
        return value;
      },
    });
    const mapping = new FieldMapping("advancement", {
      path: "system.advancement",
      converter: "failingObjectConverter",
    }, registry);
    const data = {
      _id: "class-1",
      name: "Barbarian",
      system: {
        advancement: {
          a: {title: "Rage"},
        },
      },
    };

    assert.deepEqual(mapping.map(data, {advancement: {}}), {});
    assert.equal(errorCalls.length, 1);
    assert.equal(errorCalls[0][1].valueType, "object");
    assert.deepEqual(errorCalls[0][1].valuePreview, {
      keys: ["a"],
    });
    assert.equal(errorCalls[0][1].translationType, "object");
    assert.deepEqual(errorCalls[0][1].translationPreview, {
      keys: [],
    });
  } finally {
    console.error = originalError;
  }
});

test("FieldMapping.map throws when a named converter bypasses registration and is not OO", () => {
  const data = {
    _id: "class-2",
    name: "Wizard",
    system: {
      advancement: [
        {_id: "adv-2", title: "Spellcasting"},
      ],
    },
  };
  const translations = {
    advancement: {
      "adv-2": {
        title: "Incantesimi",
      },
    },
  };
  const registry = {
    named(name) {
      return name === "advancement" ? (() => ({translated: true})) : null;
    },
  };
  const mapping = new FieldMapping("advancement", {
    path: "system.advancement",
    converter: "advancement",
  }, registry);

  assert.throws(
    () => mapping.map(data, translations),
    /not a supported OO converter/,
  );
});

test("FieldMapping.extract preserves legacy behavior for fields whose source path does not exist", () => {
  const mapping = new FieldMapping("description", "system.description.value", null);
  const data = {
    _id: "item-missing-extract-path",
    name: "Broken extractor",
    system: {},
  };

  assert.deepEqual(mapping.extract(data), {description: undefined});
});
