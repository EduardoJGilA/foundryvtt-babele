import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args);

const {TranslationRegistry} = await import("../module/script/translation/translation-registry.js");

function createRegistry(overrides = {}) {
  game.settings.get = (_namespace, key) => {
    if (key === "language") {
      return overrides.language ?? "it";
    }

    if (key === "directory") {
      return overrides.directory ?? "";
    }

    if (key === "translationFiles") {
      return overrides.storedTranslationFiles ?? [];
    }

    if (key === "mappingFiles") {
      return overrides.storedMappingFiles ?? [];
    }

    return "";
  };
  game.user.isGM = overrides.isGM ?? true;
  game.user.hasPermission = () => overrides.canIndexFiles ?? true;
  game.system.id = overrides.systemId ?? "test-system";
  foundry.applications.apps.FilePicker.browse = overrides.browse ?? (async () => ({files: []}));

  const registry = new TranslationRegistry();

  for (const module of overrides.modules ?? []) {
    registry.registerModule(module);
  }

  return registry;
}

test("TranslationRegistry deduplicates translation files and groups pack sources", async () => {
  const registry = createRegistry({
    modules: [
      {module: "module-one", dir: "translations", lang: "it"},
      {module: "module-two", dir: "translations", lang: "it"},
    ],
    browse: async (_source, dir) => {
      if (dir === "modules/module-one/translations") {
        return {
          files: [
            "modules/module-one/translations/test.items.json",
            "modules/module-one/translations/test.items.json",
          ],
        };
      }

      if (dir === "modules/module-two/translations") {
        return {
          files: [
            "modules/module-two/translations/test.items.json",
            "modules/module-two/translations/test.actor.json",
          ],
        };
      }

      return {files: []};
    },
  });

  const files = (await registry.translationSources()).map((source) => source.file);
  const itemSources = await registry.sourcesFor("test.items");
  const diagnostics = await registry.diagnostics();

  assert.deepEqual(files, [
    "modules/module-one/translations/test.items.json",
    "modules/module-two/translations/test.items.json",
    "modules/module-two/translations/test.actor.json",
  ]);
  assert.deepEqual(itemSources.map((source) => source.file), [
    "modules/module-one/translations/test.items.json",
    "modules/module-two/translations/test.items.json",
  ]);
  assert.equal(diagnostics.translation.duplicateFilesDiscarded, 1);
  assert.equal(
    diagnostics.translation.packs.find((pack) => pack.collection === "test.items").sourceCount,
    2,
  );
});

test("TranslationRegistry supports multiple directories from one module registration", async () => {
  const registry = createRegistry({
    modules: [
      {module: "translation-suite", dirs: ["pf2e", "sf2e"], lang: "it"},
    ],
    browse: async (_source, dir) => {
      if (dir === "modules/translation-suite/pf2e") {
        return {
          files: [
            "modules/translation-suite/pf2e/pf2e.feats.json",
          ],
        };
      }

      if (dir === "modules/translation-suite/sf2e") {
        return {
          files: [
            "modules/translation-suite/sf2e/sf2e.actions.json",
          ],
        };
      }

      return {files: []};
    },
  });

  const sources = await registry.translationSources();

  assert.deepEqual(sources.map((source) => source.file), [
    "modules/translation-suite/pf2e/pf2e.feats.json",
    "modules/translation-suite/sf2e/sf2e.actions.json",
  ]);
  assert.deepEqual(sources.map((source) => source.source), [
    "module:translation-suite:it",
    "module:translation-suite:it",
  ]);
});

test("TranslationRegistry merges repeated module registrations into one multi-directory source", async () => {
  const registry = createRegistry({
    modules: [
      {module: "translation-suite", dir: "pf2e", lang: "it"},
      {module: "translation-suite", dir: "sf2e", lang: "it"},
    ],
    browse: async (_source, dir) => {
      if (dir === "modules/translation-suite/pf2e") {
        return {
          files: [
            "modules/translation-suite/pf2e/pf2e.feats.json",
          ],
        };
      }

      if (dir === "modules/translation-suite/sf2e") {
        return {
          files: [
            "modules/translation-suite/sf2e/sf2e.actions.json",
          ],
        };
      }

      return {files: []};
    },
  });

  const sources = await registry.translationSources();

  assert.deepEqual(sources.map((source) => source.file), [
    "modules/translation-suite/pf2e/pf2e.feats.json",
    "modules/translation-suite/sf2e/sf2e.actions.json",
  ]);
  assert.deepEqual(sources.map((source) => source.source), [
    "module:translation-suite:it",
    "module:translation-suite:it",
  ]);
});

test("TranslationRegistry prefers canonical mappings.json within the same directory", async () => {
  warnings.length = 0;

  const registry = createRegistry({
    modules: [
      {module: "module-one", dir: "translations", lang: "it"},
    ],
    browse: async (_source, dir) => {
      if (dir === "modules/module-one/translations") {
        return {
          files: [
            "modules/module-one/translations/mapping.json",
            "modules/module-one/translations/mappings.json",
            "modules/module-one/translations/test.items.json",
          ],
        };
      }

      return {files: []};
    },
  });

  const mappingFiles = (await registry.mappingSources()).map((source) => source.file);

  assert.deepEqual(mappingFiles, [
    "modules/module-one/translations/mappings.json",
  ]);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /both 'mappings\.json' and deprecated 'mapping\.json'/);
});

test("TranslationRegistry does not treat mapping files as compendium translation files", async () => {
  const registry = createRegistry({
    modules: [
      {module: "module-one", dir: "translations", lang: "it"},
    ],
    browse: async (_source, dir) => {
      if (dir === "modules/module-one/translations") {
        return {
          files: [
            "modules/module-one/translations/mapping.json",
            "modules/module-one/translations/mappings.json",
            "modules/module-one/translations/test.items.json",
          ],
        };
      }

      return {files: []};
    },
  });

  const translationFiles = (await registry.translationSources()).map((source) => source.file);

  assert.deepEqual(translationFiles, [
    "modules/module-one/translations/test.items.json",
  ]);
});

test("TranslationRegistry falls back to stored file lists when indexing is unavailable", async () => {
  const registry = createRegistry({
    canIndexFiles: false,
    storedTranslationFiles: [
      "worlds/my-world/it/test.items.json",
      "worlds/my-world/it/test.items.json",
    ],
    storedMappingFiles: [
      "worlds/my-world/mappings.json",
    ],
  });

  const translations = (await registry.translationSources()).map((source) => source.file);
  const mappings = (await registry.mappingSources()).map((source) => source.file);
  const diagnostics = await registry.diagnostics();

  assert.deepEqual(translations, ["worlds/my-world/it/test.items.json"]);
  assert.deepEqual(mappings, ["worlds/my-world/mappings.json"]);
  assert.equal(diagnostics.translation.fromSettings, true);
  assert.equal(diagnostics.mapping.fromSettings, true);
});

test.after(() => {
  console.warn = originalWarn;
});
