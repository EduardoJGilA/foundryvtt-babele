import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {MappedCompendium} = await import("../module/script/mapped-compendium.js");
const {AdventureMappedCompendium, createMappedCompendium} = await import("../module/script/mapped-compendium-decorator.js");
const {CompendiumRuntime} = await import("../module/script/compendium-runtime.js");
const {TranslatedCompendium} = await import("../module/script/translated-compendium.js");
const {default: Babel} = await import("../module/script/babele.js");

test("MappedCompendium is the canonical class behind TranslatedCompendium compatibility exports", () => {
  const compendium = new MappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "item-1": {
        name: "Spada",
      },
    },
  });

  assert.equal(compendium instanceof MappedCompendium, true);
  assert.equal(compendium instanceof TranslatedCompendium, true);
  assert.equal(compendium.hasTranslation({_id: "item-1", name: "Sword"}), true);
});

test("MappedCompendium translates index rows in place", () => {
  const compendium = new MappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "item-1": {
        name: "Spada",
      },
    },
  });
  const index = [{_id: "item-1", name: "Sword"}];

  const result = compendium.translateIndex(index);

  assert.equal(result, index);
  assert.equal(index[0].name, "Spada");
  assert.equal(index[0].translated, true);
});

test("MappedCompendium leaves documents unchanged when no translation entry matches", () => {
  const compendium = new MappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {},
  });
  const data = {
    _id: "missing",
    name: "Sword",
    system: {
      description: {
        value: "Original description",
      },
    },
  };

  assert.deepEqual(compendium.translate(data), data);
});

test("MappedCompendium marks hasTranslation without marking translated when the merged payload is unchanged", () => {
  const compendium = new MappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "item-1": {
        name: "Sword",
      },
    },
  });
  const data = {
    _id: "item-1",
    name: "Sword",
  };

  const translated = compendium.translate(data);

  assert.equal(translated.name, "Sword");
  assert.equal(translated.hasTranslation, true);
  assert.equal(translated.translated, false);
  assert.equal(translated.flags.babele.hasTranslation, true);
  assert.equal(translated.flags.babele.translated, false);
});

test("MappedCompendium extracts document payloads without requiring translations", () => {
  const compendium = new MappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    mapping: {
      description: "system.description.value",
    },
    entries: {},
  });

  assert.deepEqual(compendium.extract({
    _id: "item-1",
    name: "Sword",
    system: {
      description: {
        value: "Original description",
      },
    },
  }), {
    name: "Sword",
    description: "Original description",
  });
});

test("createMappedCompendium decorates Adventure compendiums", () => {
  const compendium = createMappedCompendium({
    id: "test.adventure",
    name: "adventure",
    type: "Adventure",
  }, {
    entries: {},
  });

  assert.equal(compendium instanceof AdventureMappedCompendium, true);
});

test("createMappedCompendium keeps Adventure entry virtual packs undecorated", () => {
  const compendium = createMappedCompendium({
    id: "test.adventure::adventureA::items",
    name: "test.adventure::adventureA::items",
    type: "Item",
    virtual: true,
    adventureCollection: "test.adventure",
    adventureEntryKey: "adventureA",
  }, {
    entries: {},
  });

  assert.equal(compendium instanceof AdventureMappedCompendium, false);
  assert.equal(compendium instanceof MappedCompendium, true);
});

test("AdventureMappedCompendium fails fast when decorating a non-adventure compendium", () => {
  const compendium = new MappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {},
  });

  assert.throws(() => new AdventureMappedCompendium(compendium), /Adventure compendiums/);
});

test("createMappedCompendium preserves Adventure translation access", () => {
  const parent = createMappedCompendium({
    id: "test.adventure",
    name: "adventure",
    type: "Adventure",
    packageName: "test",
    packageType: "module",
  }, {
    mapping: {
      items: {
        description: "system.description.value",
      },
    },
    entries: {
      adventureA: {
        items: {
          "item-a": {
            name: "Translated A",
            description: "Description A",
          },
        },
      },
    },
  });
  const translations = parent.translationsFor({
    _id: "adventureA",
    name: "Adventure A",
  });

  assert.deepEqual(translations.items?.["item-a"], {
    name: "Translated A",
    description: "Description A",
  });
});

test("AdventureMappedCompendium reuses the scoped runtime for the same entry", () => {
  const parent = createMappedCompendium({
    id: "test.adventure",
    name: "adventure",
    type: "Adventure",
    packageName: "test",
    packageType: "module",
  }, {
    entries: {
      adventureA: {
        actors: {
          "actor-a": {
            name: "Translated Actor",
          },
        },
      },
    },
  });
  const runtime = new CompendiumRuntime();
  const entry = {
    _id: "adventureA",
    name: "Adventure A",
  };

  let childCalls = 0;
  const originalChild = runtime.child.bind(runtime);
  runtime.child = (localPacks) => {
    childCalls += 1;
    return originalChild(localPacks);
  };

  parent.translate(entry, true, runtime);
  parent.translate(entry, true, runtime);

  assert.equal(childCalls, 1);
});

test("Babel delegates translation and extraction operations to MappedCompendium", () => {
  const babele = new Babel();
  const translatedCompendium = new MappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      "item-1": {
        name: "Spada",
      },
    },
  });

  babele.packs = new foundry.utils.Collection([["test.items", translatedCompendium]]);

  assert.equal(babele.isTranslated("test.items"), true);
  assert.equal(babele.translate("test.items", {_id: "item-1", name: "Sword"}).name, "Spada");
  assert.equal(babele.translateField("name", "test.items", {_id: "item-1", name: "Sword"}), "Spada");
  assert.equal(babele.translateIndex([{_id: "item-1", name: "Sword"}], "test.items")[0].name, "Spada");
});

test("Babel propagates registered translation match strategies to existing mapped compendiums", () => {
  const babele = new Babel();
  const translatedCompendium = new MappedCompendium({
    id: "test.items",
    name: "items",
    type: "Item",
  }, {
    entries: {
      feat: {
        name: "Talento Tradotto",
        type: "feat",
      },
    },
  });

  babele.packs = new foundry.utils.Collection([["test.items", translatedCompendium]]);
  babele.registerTranslationMatchStrategy({
    name: "entry-type",
    matches: (data, _key, translation, context) => (
      context.documentType === "Item" && translation.type === data?.type
    ),
  });

  assert.equal(
    translatedCompendium.hasTranslation({_id: "missing-id", name: "Shared", type: "feat"}),
    true,
  );
});

test("Babel.init registers supported packs as mapped compendiums even without translations", async () => {
  const babele = new Babel();
  babele.loadTranslations = async () => [];
  game.data.packs = [{
    type: "Item",
    packageName: "test",
    packageType: "module",
    name: "items",
    label: "Items",
  }];

  assert.equal(await babele.init(), true);
  assert.equal(babele.mappedCompendiumFor("test.items") instanceof MappedCompendium, true);
  assert.equal(babele.isTranslated("test.items"), false);
});

test("Babel extracts using the mapped compendium registered at init even when untranslated", async () => {
  const babele = new Babel();
  babele.loadTranslations = async () => [];
  game.data.packs = [{
    type: "Item",
    packageName: "test",
    packageType: "module",
    name: "items",
    label: "Items",
  }];

  await babele.init();
  const extracted = babele.extract("test.items", {
    _id: "item-1",
    name: "Sword",
    system: {
      description: {
        value: "Original description",
      },
    },
  });

  assert.deepEqual(extracted, {
    name: "Sword",
    description: "Original description",
  });
  assert.equal(!!babele.mappedCompendiumFor("test.items"), true);
});
