import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const originalError = console.error;
const errors = [];
console.error = (...args) => {
  errors.push(args);
};

const {
  contextFromArgs,
  translateResult,
  preserveIndexFlags,
} = await import("../module/script/wrapper.js");

test("wrapper extracts normalized _getDocuments context from Foundry arguments", () => {
  class FakeDocument {}

  const context = contextFromArgs([
    FakeDocument,
    {
      pack: "test.items",
      options: {
        index: true,
      },
    },
  ]);

  assert.equal(context.documentClass, FakeDocument);
  assert.equal(context.pack, "test.items");
  assert.equal(context.index, true);
});

test("wrapper translates index results through Babele", async () => {
  const babele = {
    async init() {
      return true;
    },
    translatedCompendiumFor(pack) {
      if (pack !== "test.items") {
        return null;
      }

      return {
        translateIndex(result) {
          return result.map((row) => ({...row, translated: true}));
        },
      };
    },
  };

  const result = await translateResult(
    [{_id: "item-1", name: "Sword"}],
    {
      pack: "test.items",
      index: true,
    },
    babele,
  );

  assert.deepEqual(result, [{_id: "item-1", name: "Sword", translated: true}]);
});

test("wrapper reconstructs translated loaded documents", async () => {
  class FakeDocument {
    constructor(data, context = {}) {
      this.data = data;
      this.context = context;
    }

    toObject() {
      return this.data;
    }
  }

  const babele = {
    async init() {
      return true;
    },
    translatedCompendiumFor() {
      return {
        translate(data) {
          return {...data, name: "Translated Sword"};
        },
      };
    },
  };

  const result = await translateResult(
    [new FakeDocument({_id: "item-1", name: "Sword"})],
    {
      pack: "test.items",
      documentClass: FakeDocument,
      index: false,
    },
    babele,
  );

  assert.equal(result[0] instanceof FakeDocument, true);
  assert.equal(result[0].data.name, "Translated Sword");
  assert.deepEqual(result[0].context, {pack: "test.items"});
});

test("wrapper fails open when loaded document translation throws", async () => {
  class FakeDocument {
    constructor(data) {
      this.data = data;
    }

    toObject() {
      return this.data;
    }
  }

  errors.length = 0;
  const original = new FakeDocument({_id: "item-1", name: "Sword"});
  const babele = {
    async init() {
      return true;
    },
    translatedCompendiumFor() {
      return {
        translate() {
          throw new Error("wrapper boom");
        },
      };
    },
  };

  const result = await translateResult(
    [original],
    {
      pack: "test.items",
      documentClass: FakeDocument,
      index: false,
    },
    babele,
  );

  assert.equal(result[0], original);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /failed to translate loaded compendium document/);
});

test("wrapper fails open when translated document reconstruction triggers validation errors", async () => {
  class FakeDocument {
    constructor(data, context = {}) {
      if (data?.prototypeToken?.ring?.subject?.texture === "") {
        throw new Error("DataModelValidationError: texture may not be a blank string");
      }

      this.data = data;
      this.context = context;
    }

    toObject() {
      return this.data;
    }
  }

  errors.length = 0;
  const original = new FakeDocument({
    _id: "npc-1",
    name: "NPC",
    prototypeToken: {
      ring: {
        subject: {
          texture: "icons/original.webp",
        },
      },
    },
  });
  const babele = {
    async init() {
      return true;
    },
    translatedCompendiumFor() {
      return {
        translate(data) {
          return {
            ...data,
            prototypeToken: {
              ring: {
                subject: {
                  texture: "",
                },
              },
            },
          };
        },
      };
    },
  };

  const result = await translateResult(
    [original],
    {
      pack: "test.actors",
      documentClass: FakeDocument,
      index: false,
    },
    babele,
  );

  assert.equal(result[0], original);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /failed to translate loaded compendium document/);
  assert.match(String(errors[0][1]?.error ?? ""), /DataModelValidationError/);
});

test("wrapper fails open on unsupported result shapes", async () => {
  const babele = {
    async init() {
      return true;
    },
    translatedCompendiumFor() {
      return {
        translate(data) {
          return data;
        },
      };
    },
  };

  assert.equal(await translateResult(null, {pack: "test.items"}, babele), null);
  assert.deepEqual(
    await translateResult(["not-an-object"], {pack: "test.items", index: false}, babele),
    ["not-an-object"],
  );
});

test("wrapper preserves babele flags when re-indexing a document", () => {
  const collection = {
    index: new foundry.utils.Collection([
      ["doc-1", {name: "Sword", originalName: "Sword"}],
    ]),
  };
  const document = {
    id: "doc-1",
    flags: {
      babele: {
        translated: true,
        originalName: "Original Sword",
      },
    },
  };

  preserveIndexFlags(collection, (doc) => {
    collection.index.set(doc.id, {name: "Spada"});
  }, [document]);

  assert.deepEqual(collection.index.get("doc-1"), {
    name: "Sword",
    originalName: "Original Sword",
    translated: true,
  });
});

test.after(() => {
  console.error = originalError;
});
