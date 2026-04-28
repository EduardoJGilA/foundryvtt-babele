import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const warnings = [];
const debugCalls = [];
const originalWarn = console.warn;
const originalDebug = console.debug;
console.warn = (...args) => warnings.push(args);
console.debug = (...args) => debugCalls.push(args);

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

    if (key === "sourcePriority") {
      return overrides.sourcePriority ?? {};
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

test("TranslationRegistry exposes and invalidates source discovery caches", async () => {
  debugCalls.length = 0;
  globalThis.CONFIG = {debug: {babele: true}};
  let browseCalls = 0;
  const registry = createRegistry({
    modules: [
      {module: "module-one", dir: "translations", lang: "it"},
    ],
    browse: async (_source, dir) => {
      browseCalls += 1;
      if (dir === "modules/module-one/translations") {
        return {
          files: [
            "modules/module-one/translations/test.items.json",
            "modules/module-one/translations/mappings.json",
          ],
        };
      }

      return {files: []};
    },
  });

  assert.equal(registry.cacheDiagnostics().translationSourcesCached, false);

  await registry.translationSources();
  await registry.translationSources();
  await registry.mappingSources();
  assert.equal(browseCalls, 2);
  assert.equal(registry.cacheDiagnostics().translationSourcesCached, true);
  assert.equal(registry.cacheDiagnostics().mappingSourcesCached, true);
  assert.equal(debugCalls.some((call) => String(call[0]).includes("using cached translation source discovery")), true);

  registry.invalidate("test");
  assert.equal(registry.cacheDiagnostics().translationSourcesCached, false);
  assert.equal(registry.cacheDiagnostics().mappingSourcesCached, false);
  assert.equal(debugCalls.some((call) => String(call[0]).includes("invalidated translation registry discovery cache")), true);
  delete globalThis.CONFIG;
});

test("TranslationRegistry detects overlapping translation sources and applies configured collection priority", async () => {
  const loaded = [];
  const registry = createRegistry({
    sourcePriority: {
      collections: {
        "test.items": [
          "module:module-two:it",
          "module:module-one:it",
        ],
      },
    },
    modules: [
      {module: "module-one", dir: "translations", lang: "it"},
      {module: "module-two", dir: "translations", lang: "it"},
    ],
    browse: async (_source, dir) => {
      if (dir === "modules/module-one/translations") {
        return {
          files: ["modules/module-one/translations/test.items.json"],
        };
      }

      if (dir === "modules/module-two/translations") {
        return {
          files: ["modules/module-two/translations/test.items.json"],
        };
      }

      return {files: []};
    },
  });
  registry._jsonLoader = async (file) => {
    loaded.push(file);
    return {
      entries: {
        item: {
          name: file.includes("module-one") ? "Module One" : "Module Two",
        },
      },
    };
  };

  const sources = await registry.sourcesFor("test.items");
  const diagnostics = await registry.diagnostics();
  const translations = await registry.loadTranslations();

  assert.deepEqual(sources.map((source) => source.source), [
    "module:module-two:it",
    "module:module-one:it",
  ]);
  assert.deepEqual(diagnostics.translation.overlaps[0].sources, [
    "module:module-two:it",
    "module:module-one:it",
  ]);
  assert.equal(diagnostics.translation.overlaps[0].customPriority, true);
  assert.deepEqual(loaded, [
    "modules/module-two/translations/test.items.json",
    "modules/module-one/translations/test.items.json",
  ]);
  assert.deepEqual(translations.for("test.items").entries.item, {
    name: "Module One",
  });
});

test("TranslationRegistry persists source priority settings", async () => {
  let storedPriority = {};
  const registry = createRegistry({
    sourcePriority: storedPriority,
  });
  game.settings.get = (_namespace, key) => key === "sourcePriority" ? storedPriority : "";
  game.settings.set = async (_namespace, key, value) => {
    if (key === "sourcePriority") {
      storedPriority = value;
    }
  };

  await registry.setSourcePriority("test.items", ["module:two", "module:one"]);
  assert.deepEqual(storedPriority, {
    global: [],
    collections: {
      "test.items": ["module:two", "module:one"],
    },
  });

  await registry.setSourcePriority("test.items", []);
  assert.deepEqual(storedPriority, {
    global: [],
    collections: {},
  });
});

test.after(() => {
  console.warn = originalWarn;
  console.debug = originalDebug;
  delete globalThis.CONFIG;
});
