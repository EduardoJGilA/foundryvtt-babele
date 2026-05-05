import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";
import {assignMappedCompendiums, mockMappedCompendiums, mockPackFolderTranslations} from "./helpers/mapped-compendiums.js";

installFoundryStubs();

const logCalls = [];
const warnCalls = [];
const errorCalls = [];
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalFetch = globalThis.fetch;

console.log = (...args) => logCalls.push(args);
console.warn = (...args) => warnCalls.push(args);
console.error = (...args) => errorCalls.push(args);

const {default: Babel} = await import("../module/script/babele.js");
const {MappedCompendium} = await import("../module/script/compendium/mapped-compendium.js");
const {FolderTranslations} = await import("../module/script/compendium/folder-translations.js");
const {ExportTranslationsDialog} = await import("../module/script/ui/export-translations-dialog.js");

async function babeleWithFolderSession({
  mappedCompendiums = mockMappedCompendiums(),
  packFolderTranslations = mockPackFolderTranslations(),
} = {}) {
  const session = {
    translations: null,
    documentMappings: null,
    mappedCompendiums,
    packFolderTranslations,
    folderTranslations: new FolderTranslations({
      mappedCompendiums,
      packFolderTranslations,
    }),
    translatePackFolders(pack) {
      this.folderTranslations.translatePackFolders(pack);
    },
    translateImportedCompendiumFolder(folder) {
      this.folderTranslations.translateImportedCompendiumFolder(folder);
    },
    translateImportedCompendiumFolders(folders) {
      this.folderTranslations.translateImportedCompendiumFolders(folders);
    },
    translateSystemPackFolders() {
      this.folderTranslations.translateSystemPackFolders();
    },
    dispose() {},
  };
  const babele = new Babel({
    engine: {
      translationSources: {
        cacheDiagnostics: () => null,
        shareTranslationFiles: async () => {},
        shareGlobalMappingFiles: async () => {},
      },
      documentMappings: () => null,
      session: async () => session,
    },
  });

  await babele.init();
  return babele;
}

test.beforeEach(() => {
  logCalls.length = 0;
  warnCalls.length = 0;
  errorCalls.length = 0;
});

test("Babel.init fails open and can retry after a bootstrap failure", async () => {
  const babele = new Babel();
  let attempts = 0;

  Object.defineProperty(game.data, "packs", {
    configurable: true,
    get() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("boom");
      }
      return [];
    },
  });

  const first = await babele.init();
  const second = await babele.init();

  assert.equal(first, false);
  assert.equal(second, true);
  assert.equal(attempts, 2);
  assert.equal(errorCalls.length >= 1, true);
  assert.match(String(errorCalls[0][0]), /initialization failed during step/);

  Object.defineProperty(game.data, "packs", {
    configurable: true,
    writable: true,
    value: [],
  });
});

test("importAdventure handles tokens with null delta and reuses prototype token names", () => {
  const updates = [];

  game.scenes = [{
    tokens: [{
      actorId: "actor-1",
      delta: null,
      update(data) {
        updates.push(data);
      },
    }, {
      actorId: "actor-1",
      delta: {name: "Custom Name"},
      update() {
        throw new Error("token with explicit delta name should not be updated");
      },
    }],
  }];

  game.actors.get = (actorId) => actorId === "actor-1"
    ? {prototypeToken: {name: "Prototype Goblin"}}
    : null;

  assert.doesNotThrow(() => Hooks.callAll("importAdventure"));
  assert.deepEqual(updates, [{name: "Prototype Goblin"}]);
});

test("Babel prefers mappings.json over deprecated mapping.json in the same directory", async () => {
  const babele = new Babel();
  babele.register({module: "module-one", dir: "translations", lang: "en"});
  game.settings.get = (_namespace, key) => {
    if (key === "language") {
      return "en";
    }
    if (key === "directory") {
      return "";
    }
    return "";
  };
  game.data.packs = [];

  foundry.applications.apps.FilePicker.browse = async (_source, dir) => {
    if (dir === "modules/module-one/translations") {
      return {
        files: [
          "modules/module-one/translations/test.items.json",
          "modules/module-one/translations/mapping.json",
          "modules/module-one/translations/mappings.json",
        ],
      };
    }
    return {files: []};
  };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("test.items.json")) {
      return {
        async json() {
          return {entries: {}};
        },
      };
    }

    if (String(url).endsWith("mapping.json")) {
      return {
        async json() {
          return {Item: {legacy: "system.legacy"}};
        },
      };
    }

    if (String(url).endsWith("mappings.json")) {
      return {
        async json() {
          return {Item: {canonical: "system.canonical"}};
        },
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  warnCalls.length = 0;
  logCalls.length = 0;

  await babele.init();

  assert.equal(babele.documentMappings.current().Item.canonical, "system.canonical");
  assert.equal(babele.documentMappings.current().Item.legacy, undefined);
  assert.equal(warnCalls.length, 1);
  assert.match(String(warnCalls[0][0]), /both 'mappings\.json' and deprecated 'mapping\.json'/);
});

test("Babel.sessionFor builds a headless session for a language different from the Foundry UI language", async () => {
  const babele = new Babel();
  babele.register({module: "module-one", dir: "translations/en", lang: "en"});
  babele.register({module: "module-one", dir: "translations/fr", lang: "fr"});
  game.settings.get = (_namespace, key) => {
    if (key === "language") {
      return "en";
    }
    if (key === "directory") {
      return "";
    }
    return "";
  };
  game.data.packs = [{
    type: "Item",
    packageName: "module-one",
    packageType: "module",
    name: "items",
  }];

  foundry.applications.apps.FilePicker.browse = async (_source, dir) => {
    if (dir === "modules/module-one/translations/en") {
      return {files: ["modules/module-one/translations/en/module-one.items.json"]};
    }
    if (dir === "modules/module-one/translations/fr") {
      return {files: ["modules/module-one/translations/fr/module-one.items.json"]};
    }
    return {files: []};
  };
  globalThis.fetch = async (url) => ({
    async json() {
      if (String(url).includes("/fr/")) {
        return {
          entries: {
            sword: {name: "Épée"},
          },
        };
      }

      return {
        entries: {
          sword: {name: "Sword"},
        },
      };
    },
  });

  const session = await babele.sessionFor({language: "fr"});

  assert.equal(session.language, "fr");
  assert.equal(babele.isTranslated("module-one.items"), false);
  assert.equal(session.isTranslated("module-one.items"), true);
  assert.deepEqual(session.translate("module-one.items", {
    _id: "sword",
    name: "Sword",
  }), {
    _id: "sword",
    name: "Épée",
    originalName: "Sword",
    translated: true,
    hasTranslation: true,
    flags: {
      babele: {
        originalName: "Sword",
        hasTranslation: true,
        translated: true,
        originalPayload: {
          name: "Sword",
        },
      },
    },
  });
});

test("Babel.sessionFor materializes packs enabled by loaded language mappings", async () => {
  const babele = new Babel();
  babele.register({module: "module-one", dir: "translations/fr", lang: "fr"});
  game.settings.get = (_namespace, key) => {
    if (key === "language") {
      return "en";
    }
    if (key === "directory") {
      return "";
    }
    return "";
  };
  game.data.packs = [{
    type: "CustomDoc",
    packageName: "module-one",
    packageType: "module",
    name: "custom",
  }];

  foundry.applications.apps.FilePicker.browse = async (_source, dir) => {
    if (dir === "modules/module-one/translations/fr") {
      return {
        files: [
          "modules/module-one/translations/fr/module-one.custom.json",
          "modules/module-one/translations/fr/mappings.json",
        ],
      };
    }
    return {files: []};
  };
  globalThis.fetch = async (url) => ({
    async json() {
      if (String(url).endsWith("mappings.json")) {
        return {
          CustomDoc: {
            name: "name",
          },
        };
      }

      return {
        entries: {
          source: {name: "Source traduit"},
        },
      };
    },
  });

  const session = await babele.sessionFor({language: "fr"});
  const pack = session.mappedCompendiumFor("module-one.custom");

  assert.notEqual(pack, null);
  assert.deepEqual(session.translate("module-one.custom", {
    _id: "source",
    name: "Source",
  }).name, "Source traduit");
});

test("Babel.init logs and skips invalid translation JSON files", async () => {
  const babele = new Babel();
  babele.register(
    {module: "module-one", dir: "translations", lang: "en"},
  );
  babele.register({module: "module-two", dir: "translations", lang: "en"});

  game.settings.get = (_namespace, key) => {
    if (key === "language") {
      return "en";
    }
    if (key === "directory") {
      return "";
    }
    return "";
  };
  game.data.packs = [{type: "Item", packageName: "module-one", packageType: "module", name: "items"}];

  foundry.applications.apps.FilePicker.browse = async (_source, dir) => {
    if (dir === "modules/module-one/translations") {
      return {
        files: ["modules/module-one/translations/module-one.items.json"],
      };
    }

    if (dir === "modules/module-two/translations") {
      return {
        files: ["modules/module-two/translations/module-one.items.json"],
      };
    }

    return {files: []};
  };

  globalThis.fetch = async (url) => {
    if (String(url) === "modules/module-one/translations/module-one.items.json") {
      return {
        async json() {
          throw new Error("invalid translation JSON");
        },
      };
    }

    if (String(url) === "modules/module-two/translations/module-one.items.json") {
      return {
        async json() {
          return {entries: {sword: {name: "Sword"}}};
        },
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await babele.init();

  assert.equal(babele.isTranslated("module-one.items"), true);
  assert.deepEqual(babele.translate("module-one.items", {
    _id: "sword",
    name: "Longsword",
  }), {
    _id: "sword",
    name: "Sword",
    originalName: "Longsword",
    hasTranslation: true,
    translated: true,
    flags: {
      babele: {
        originalName: "Longsword",
        hasTranslation: true,
        translated: true,
        originalPayload: {
          name: "Longsword",
        },
      },
    },
  });
  assert.equal(errorCalls.length, 1);
  assert.match(String(errorCalls[0][0]), /failed to load translation file/);
  assert.equal(errorCalls[0][1].kind, "translation");
  assert.equal(errorCalls[0][1].collection, "module-one.items");
  assert.equal(errorCalls[0][1].file, "modules/module-one/translations/module-one.items.json");
  assert.match(String(errorCalls[0][1].error), /invalid translation JSON/);
});

test("Babel.init logs and skips invalid mapping JSON files", async () => {
  const babele = new Babel();
  babele.register(
    {module: "module-one", dir: "translations", lang: "en"},
  );
  babele.register({module: "module-two", dir: "translations", lang: "en"});

  game.settings.get = (_namespace, key) => {
    if (key === "language") {
      return "en";
    }
    if (key === "directory") {
      return "";
    }
    return "";
  };
  game.data.packs = [];

  foundry.applications.apps.FilePicker.browse = async (_source, dir) => {
    if (dir === "modules/module-one/translations") {
      return {
        files: ["modules/module-one/translations/mappings.json"],
      };
    }

    if (dir === "modules/module-two/translations") {
      return {
        files: ["modules/module-two/translations/mappings.json"],
      };
    }

    return {files: []};
  };

  globalThis.fetch = async (url) => {
    if (String(url) === "modules/module-one/translations/mappings.json") {
      throw new Error("mapping fetch failed");
    }

    if (String(url) === "modules/module-two/translations/mappings.json") {
      return {
        async json() {
          return {Item: {structured: "system.structured"}};
        },
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await babele.init();

  assert.equal(babele.documentMappings.current().Item.structured, "system.structured");
  const mappingError = errorCalls.find(
    ([message, details]) => /failed to load mapping file/.test(String(message))
      && details?.file === "modules/module-one/translations/mappings.json",
  );
  assert.equal(!!mappingError, true);
  assert.equal(mappingError[1].kind, "mapping");
  assert.equal(mappingError[1].phase, "global defaults enrichment");
  assert.equal(mappingError[1].file, "modules/module-one/translations/mappings.json");
  assert.match(String(mappingError[1].error), /mapping fetch failed/);
});

test("Babel.translatedPackFor delegates precedence to CompendiumRuntime", () => {
  const babele = new Babel();
  const firstPack = {
    translated: true,
    metadata: {type: "Item"},
    hasTranslation(data, documentType) {
      return documentType === "Item" && data._id === "shared-id";
    },
  };
  const lastPack = {
    translated: true,
    metadata: {type: "Item"},
    hasTranslation(data, documentType) {
      return documentType === "Item" && data._id === "shared-id";
    },
  };

  assignMappedCompendiums(babele, [
    ["first.items", firstPack],
    ["last.items", lastPack],
  ]);

  const resolved = babele.translatedPackFor("Item", {_id: "shared-id"});

  assert.equal(resolved, lastPack);
});

test("Babel.reinitialize replaces loaded global mappings instead of accumulating them", async () => {
  const babele = new Babel();
  let phase = 1;

  babele.register({module: "module-one", dir: "translations", lang: "en"});
  game.settings.get = (_namespace, key) => {
    if (key === "language") {
      return "en";
    }
    if (key === "directory") {
      return "";
    }
    return "";
  };
  game.data.packs = [];

  foundry.applications.apps.FilePicker.browse = async (_source, dir) => {
    if (dir === "modules/module-one/translations") {
      return {
        files: ["modules/module-one/translations/mappings.json"],
      };
    }

    return {files: []};
  };

  globalThis.fetch = async (url) => {
    if (String(url).endsWith("mappings.json")) {
      return {
        async json() {
          return phase === 1
            ? {Item: {phaseOne: "system.phaseOne"}}
            : {Item: {phaseTwo: "system.phaseTwo"}};
        },
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await babele.init();
  assert.equal(babele.documentMappings.current().Item.phaseOne, "system.phaseOne");
  assert.equal(babele.documentMappings.current().Item.phaseTwo, undefined);

  phase = 2;
  await babele.reinitialize();

  assert.equal(babele.documentMappings.current().Item.phaseOne, undefined);
  assert.equal(babele.documentMappings.current().Item.phaseTwo, "system.phaseTwo");
});

test("Babel.translate fails open for translated packs when a converter throws", () => {
  const babele = new Babel();
  const originalGameBabele = game.babele;
  game.babele = babele;
  babele.registerConverter("explode", () => {
    throw new Error("import converter boom");
  });

  const tc = new MappedCompendium({
    id: "test.actors",
    name: "actors",
    type: "Actor",
  }, {
    mapping: {
      items: {
        path: "items",
        converter: "explode",
      },
    },
    entries: {
      "actor-1": {
        items: {},
      },
    },
  }, {
    documentMappings: babele.documentMappings,
  });

  assignMappedCompendiums(babele, [["test.actors", tc]]);

  const data = {
    _id: "actor-1",
    name: "Bestiary Entry",
    items: [{_id: "item-1", name: "Broken Item"}],
  };

  assert.doesNotThrow(() => babele.translate("test.actors", structuredClone(data)));
  const translated = babele.translate("test.actors", structuredClone(data));
  assert.deepEqual(translated.items, data.items);
  assert.equal(translated.hasTranslation, true);
  assert.equal(translated.translated, false);
  assert.equal(translated.flags.babele.hasTranslation, true);
  assert.equal(translated.flags.babele.translated, false);
  assert.equal(errorCalls.length >= 1, true);
  assert.match(String(errorCalls.at(-1)[0]), /converter 'explode' failed during translate/);

  game.babele = originalGameBabele;
});

test("Babel.translateSystemPackFolders uses special _packs-folders translations from pack folders payload", async () => {
  const worldFolders = [
    {name: "Bestiary"},
    {name: "Rules"},
  ];

  const babele = await babeleWithFolderSession({
    packFolderTranslations: mockPackFolderTranslations([[
    "test-system._packs-folders",
    {
      entries: {
        Bestiary: "Bestiario",
        Rules: "Regole",
      },
    },
    ]]),
  });

  game.data.folders = worldFolders;
  game.collections.set("Folder", worldFolders);

  babele.translateSystemPackFolders();

  assert.equal(worldFolders[0].name, "Bestiario");
  assert.equal(worldFolders[1].name, "Regole");
});

test("Babel.translatePackFolders uses the compendium translation folders payload", async () => {
  const pack = {
    metadata: {
      id: "test.items",
    },
    folders: new foundry.utils.Collection([
      ["folder-a", {name: "Equipment"}],
      ["folder-b", {name: "Treasure"}],
    ]),
  };

  const babele = await babeleWithFolderSession({
    mappedCompendiums: mockMappedCompendiums([[
    "test.items",
    {
      folders: {
        Equipment: "Equipaggiamento",
      },
    },
    ]]),
  });

  babele.translatePackFolders(pack);

  assert.equal(pack.folders.get("folder-a").name, "Equipaggiamento");
  assert.equal(pack.folders.get("folder-b").name, "Treasure");
});

test("Babel.translateImportedCompendiumFolder uses the source pack folder translations", async () => {
  const folder = {
    id: "folder-a",
    name: "Equipment",
    _stats: {
      compendiumSource: "Compendium.test.items.Folder.folder-a",
    },
  };

  const babele = await babeleWithFolderSession({
    mappedCompendiums: mockMappedCompendiums([[
    "test.items",
    {
      folders: {
        Equipment: "Equipaggiamento",
      },
    },
    ]]),
  });

  babele.translateImportedCompendiumFolder(folder);

  assert.equal(folder.originalName, "Equipment");
  assert.equal(folder.name, "Equipaggiamento");
});

test("Babel.translateImportedCompendiumFolder falls back to matching the imported folder id against source pack folders", async () => {
  const folder = {
    id: "folder-a",
    name: "Equipment",
    type: "Item",
  };

  const babele = await babeleWithFolderSession({
    mappedCompendiums: mockMappedCompendiums([[
    "test.items",
    {
      folders: {
        Equipment: "Equipaggiamento",
      },
    },
    ]]),
  });

  game.packs = new foundry.utils.Collection([[
    "test.items",
    {
      collection: "test.items",
      metadata: {
        type: "Item",
      },
      folders: new foundry.utils.Collection([
        ["folder-a", {_id: "folder-a", name: "Equipment"}],
      ]),
    },
  ]]);

  babele.translateImportedCompendiumFolder(folder);

  assert.equal(folder.originalName, "Equipment");
  assert.equal(folder.name, "Equipaggiamento");
});

test("Babel.translateImportedCompendiumFolders reapplies translations to imported world folders", async () => {
  const worldFolders = new foundry.utils.Collection([
    ["folder-a", {
      name: "Equipment",
      _stats: {
        compendiumSource: "Compendium.test.items.Folder.folder-a",
      },
    }],
    ["folder-b", {
      name: "Rules",
    }],
  ]);

  const babele = await babeleWithFolderSession({
    mappedCompendiums: mockMappedCompendiums([[
    "test.items",
    {
      folders: {
        Equipment: "Equipaggiamento",
      },
    },
    ]]),
  });

  babele.translateImportedCompendiumFolders(worldFolders);

  assert.equal(worldFolders.get("folder-a").name, "Equipaggiamento");
  assert.equal(worldFolders.get("folder-a").originalName, "Equipment");
  assert.equal(worldFolders.get("folder-b").name, "Rules");
});

test("Babel.exportTranslationsFile includes compendium folders using original names", async () => {
  const mappedCompendiums = mockMappedCompendiums([[
    "test.items",
    {
      folders: {
        Equipment: "Equipaggiamento",
      },
    },
  ]]);
  const babele = await babeleWithFolderSession({mappedCompendiums});
  const originalPrompt = ExportTranslationsDialog.prototype.prompt;
  const originalZip = globalThis.JSZip;
  const originalSaveAs = globalThis.saveAs;
  const originalInfo = globalThis.ui.notifications.info;
  let dialogOptions = null;
  let savedContent = null;
  let savedName = null;
  let zipInstance = null;
  const progressCalls = [];

  try {
    ExportTranslationsDialog.prototype.prompt = async function () {
      dialogOptions = {
        hasTranslations: this.hasTranslations,
        format: this.format,
        selection: this.selection,
        counts: this.counts,
      };
      return {format: "compatible", selection: "all"};
    };
    globalThis.JSZip = class {
      constructor() {
        this.files = {};
        zipInstance = this;
      }

      file(name, data) {
        this.files[name] = data;
      }

      async generateAsync(_options, onUpdate) {
        onUpdate?.({percent: 42});
        return this.files;
      }
    };
    globalThis.saveAs = (content, name) => {
      savedContent = content;
      savedName = name;
    };
    globalThis.ui.notifications.info = (message, options) => {
      progressCalls.push({message, options});
      return {
        update(update) {
          progressCalls.push({update});
        },
      };
    };

    const pack = {
      collection: "test.items",
      metadata: {
        id: "test.items",
        label: "Items",
      },
      folders: new foundry.utils.Collection([
        ["folder-a", {name: "Equipment"}],
      ]),
      async getIndex() {
        return [{_id: "item-1"}];
      },
      async getDocument() {
        return {
          name: "Sword",
          getFlag() {
            return null;
          },
        };
      },
    };

    babele.extract = () => ({
      name: "Sword",
    });
    babele.translatePackFolders(pack);

    await babele.exportTranslationsFile(pack);

    const exported = JSON.parse(zipInstance.files["test.items.json"]);

    assert.equal(pack.folders.get("folder-a").name, "Equipaggiamento");
    assert.equal(pack.folders.get("folder-a").originalName, "Equipment");
    assert.deepEqual(dialogOptions.counts, {
      all: 1,
      present: 0,
      missing: 1,
    });
    assert.deepEqual(exported.folders, {
      Equipment: "Equipment",
    });
    assert.deepEqual(exported.entries, {
      Sword: {
        name: "Sword",
      },
    });
    assert.deepEqual(progressCalls, [
      {message: "Babele | Exporting Items zip", options: {progress: true, console: false}},
      {update: {message: "Babele | Exporting Items zip", pct: 0.01}},
      {update: {message: "Babele | Exporting Items zip", pct: 0.42}},
      {update: {message: "Babele | Exporting Items zip", pct: 1}},
    ]);
    assert.equal(savedName, "test.items.zip");
    assert.equal(savedContent, zipInstance.files);
  } finally {
    ExportTranslationsDialog.prototype.prompt = originalPrompt;
    globalThis.JSZip = originalZip;
    globalThis.saveAs = originalSaveAs;
    globalThis.ui.notifications.info = originalInfo;
  }
});

test("Babel.exportTranslationsFile computes dialog counts from the index without loading documents before confirmation", async () => {
  const babele = new Babel();
  const originalPrompt = ExportTranslationsDialog.prototype.prompt;
  let getDocumentCalls = 0;
  let dialogOptions = null;

  try {
    ExportTranslationsDialog.prototype.prompt = async function () {
      dialogOptions = {
        hasTranslations: this.hasTranslations,
        format: this.format,
        selection: this.selection,
        counts: this.counts,
      };
      return null;
    };

    const pack = {
      collection: "test.items",
      metadata: {
        id: "test.items",
        label: "Items",
      },
      async getIndex() {
        return [
          {_id: "item-1", name: "Sword", flags: {babele: {hasTranslation: true}}},
          {_id: "item-2", name: "Shield"},
        ];
      },
      async getDocument() {
        getDocumentCalls += 1;
        return null;
      },
    };

    assignMappedCompendiums(babele, [[
      "test.items",
      {
        translated: true,
      },
    ]]);

    await babele.exportTranslationsFile(pack);

    assert.deepEqual(dialogOptions.counts, {
      all: 2,
      present: 1,
      missing: 1,
    });
    assert.equal(getDocumentCalls, 0);
  } finally {
    ExportTranslationsDialog.prototype.prompt = originalPrompt;
  }
});

test("Babel.exportTranslationsFile computes dialog counts correctly from Collection-backed indexes", async () => {
  const babele = new Babel();
  const originalPrompt = ExportTranslationsDialog.prototype.prompt;
  let dialogOptions = null;

  try {
    ExportTranslationsDialog.prototype.prompt = async function () {
      dialogOptions = {
        hasTranslations: this.hasTranslations,
        format: this.format,
        selection: this.selection,
        counts: this.counts,
      };
      return null;
    };

    const pack = {
      collection: "test.items",
      metadata: {
        id: "test.items",
        label: "Items",
      },
      async getIndex() {
        return new foundry.utils.Collection([
          ["item-1", {_id: "item-1", name: "Sword", flags: {babele: {hasTranslation: true}}}],
          ["item-2", {_id: "item-2", name: "Shield"}],
        ]);
      },
      async getDocument() {
        throw new Error("getDocument should not be called before confirmation");
      },
    };

    assignMappedCompendiums(babele, [[
      "test.items",
      {
        translated: true,
      },
    ]]);

    await babele.exportTranslationsFile(pack);

    assert.deepEqual(dialogOptions.counts, {
      all: 2,
      present: 1,
      missing: 1,
    });
  } finally {
    ExportTranslationsDialog.prototype.prompt = originalPrompt;
  }
});

test("Babel.exportDataFor exports present and missing entries according to selection mode", async () => {
  const babele = new Babel();
  const pack = {
    collection: "test.items",
    metadata: {
      id: "test.items",
      label: "Items",
    },
    folders: new foundry.utils.Collection(),
    async getIndex() {
      return [{_id: "item-1"}, {_id: "item-2"}];
    },
    async getDocument(id) {
      if (id === "item-1") {
        return {
          _id: "item-1",
          name: "Sword",
          description: "Original sword",
        };
      }

      return {
        _id: "item-2",
        name: "Shield",
        description: "Original shield",
      };
    },
  };

  babele.extract = (_pack, data) => ({
    name: data.name,
    description: data.description,
  });

  assignMappedCompendiums(babele, [[
    "test.items",
    {
      translated: true,
      hasTranslation(data) {
        return data._id === "item-1";
      },
      translate(data) {
        if (data._id !== "item-1") {
          return data;
        }

        return {
          ...data,
          name: "Spada",
          description: "Descrizione tradotta",
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
        };
      },
    },
  ]]);

  const allEntries = await babele.exportDataFor(pack, {format: "compatible", selection: "all"});
  const sourceOnly = await babele.exportDataFor(pack, {format: "compatible", selection: "source"});
  const presentOnly = await babele.exportDataFor(pack, {format: "compatible", selection: "present"});
  const missingOnly = await babele.exportDataFor(pack, {format: "compatible", selection: "missing"});

  assert.deepEqual(allEntries.entries, {
    Sword: {
      name: "Spada",
      description: "Descrizione tradotta",
    },
    Shield: {
      name: "Shield",
      description: "Original shield",
    },
  });
  assert.deepEqual(sourceOnly.entries, {
    Sword: {
      name: "Sword",
      description: "Original sword",
    },
    Shield: {
      name: "Shield",
      description: "Original shield",
    },
  });
  assert.deepEqual(presentOnly.entries, {
    Sword: {
      name: "Spada",
      description: "Descrizione tradotta",
    },
  });
  assert.deepEqual(missingOnly.entries, {
    Shield: {
      name: "Shield",
      description: "Original shield",
    },
  });
});

test("Babel.exportDataFor source selection uses Babele original payload from translated cached documents", async () => {
  const babele = new Babel();
  const pack = {
    collection: "test.items",
    metadata: {
      id: "test.items",
      label: "Items",
    },
    folders: new foundry.utils.Collection(),
    async getIndex() {
      return [{_id: "item-1"}];
    },
    async getDocument() {
      return {
        _id: "item-1",
        name: "Spada",
        type: "weapon",
        system: {
          description: {
            value: "Descrizione tradotta",
          },
        },
        originalName: "Sword",
        hasTranslation: true,
        translated: true,
        flags: {
          babele: {
            originalName: "Sword",
            hasTranslation: true,
            translated: true,
            originalPayload: {
              name: "Sword",
              description: "Original description",
            },
          },
        },
      };
    },
  };

  babele.extract = (_pack, data) => ({
    name: data.name,
    description: data.system?.description?.value,
  });

  assignMappedCompendiums(babele, [[
    "test.items",
    {
      translated: true,
      hasTranslation() {
        return true;
      },
      translate(data) {
        return data;
      },
    },
  ]]);

  const sourceOnly = await babele.exportDataFor(pack, {format: "compatible", selection: "source"});

  assert.deepEqual(sourceOnly.entries, {
    Sword: {
      name: "Sword",
      description: "Original description",
    },
  });
});

test("Babel.exportDataFor source selection skips translated cached documents without original payload", async () => {
  const babele = new Babel();
  const pack = {
    collection: "test.items",
    metadata: {
      id: "test.items",
      label: "Items",
    },
    folders: new foundry.utils.Collection(),
    async getIndex() {
      return [{
        _id: "item-1",
        name: "Sword",
        type: "weapon",
        system: {
          description: {
            value: "Original description",
          },
        },
      }];
    },
    async getDocument() {
      return {
        _id: "item-1",
        name: "Spada",
        type: "weapon",
        system: {
          description: {
            value: "Descrizione tradotta",
          },
        },
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
      };
    },
  };

  babele.extract = (_pack, data) => ({
    name: data.name,
    description: data.system?.description?.value,
  });

  assignMappedCompendiums(babele, [[
    "test.items",
    {
      translated: true,
      hasTranslation() {
        return true;
      },
      translate(data) {
        return data;
      },
    },
  ]]);

  const sourceOnly = await babele.exportDataFor(pack, {format: "compatible", selection: "source"});

  assert.deepEqual(sourceOnly.entries, {});
});

test("Babel.exportDataFor falls back to built-in extractor when a custom converter overrides translate only", async () => {
  const babele = new Babel();
  const pack = {
    collection: "test.journals",
    metadata: {
      id: "test.journals",
      label: "Journals",
    },
    folders: new foundry.utils.Collection(),
    async getIndex() {
      return [{_id: "journal-1"}];
    },
    async getDocument() {
      return {
        _id: "journal-1",
        name: "Rules",
        pages: [
          {
            _id: "page-1",
            name: "Introduction",
            text: {content: "<p>Hello</p>"},
            image: {caption: ""},
            video: {},
          },
        ],
      };
    },
  };

  const originalPagesConverter = babele.converters.pages;

  babele.registerConverter("pages", (pages, translations, data, tc, allTranslations, runtime, params) =>
    originalPagesConverter.translate({
      value: pages,
      translation: translations,
      source: data,
      field: "pages",
      path: "pages",
      params,
      allTranslations,
      contextCompendium: tc,
      runtime,
    }),
  );

  assignMappedCompendiums(babele, [[
    "test.journals",
    {
      translated: false,
      extract(data) {
        return {
          name: data.name,
          pages: {
            Introduction: {
              name: "Introduction",
              text: "<p>Hello</p>",
            },
          },
        };
      },
    },
  ]]);

  const exported = await babele.exportDataFor(pack, {format: "compatible", selection: "all"});

  assert.deepEqual(exported.entries, {
    Rules: {
      name: "Rules",
      pages: {
        Introduction: {
          name: "Introduction",
          text: "<p>Hello</p>",
        },
      },
    },
  });
});

test("Babel.registerConverter normalizes function and OO converters to the internal converter contract", () => {
  const babele = new Babel();

  const functional = (value) => `${value} functional`;
  let prepareContext = null;
  functional.prepare = (_value, _translation, _source, tc, _allTranslations, runtime, params) => {
    prepareContext = {tc, runtime, params};
    return undefined;
  };
  functional.extract = (value) => ({value});

  const ooConverter = {
    translate(context) {
      return `${context.value} oo`;
    },
    extract(context) {
      return {value: context.value};
    },
  };

  babele.registerConverter("functionalExample", functional);
  babele.registerConverter("ooExample", ooConverter);

  assert.equal(typeof babele.converters.functionalExample.translate, "function");
  assert.equal(typeof babele.converters.functionalExample.extract, "function");
  assert.equal(typeof babele.converters.functionalExample.isDynamic, "undefined");
  babele.converters.functionalExample.prepare({
    value: "test",
    translation: null,
    source: {},
    field: "field",
    path: "field",
    params: {converter: "functionalExample"},
    allTranslations: {},
    contextCompendium: {id: "tc"},
    runtime: {id: "runtime"},
  });
  assert.deepEqual(prepareContext, {
    tc: {id: "tc"},
    runtime: {id: "runtime"},
    params: {converter: "functionalExample"},
  });
  assert.equal(babele.converters.functionalExample.translate({
    value: "test",
    translation: null,
    source: {},
    field: "field",
    path: "field",
    params: {converter: "functionalExample"},
    allTranslations: {},
    contextCompendium: null,
    runtime: {},
  }), "test functional");

  assert.equal(typeof babele.converters.ooExample.translate, "function");
  assert.equal(typeof babele.converters.ooExample.extract, "function");
  assert.equal(typeof babele.converters.ooExample.isDynamic, "undefined");
  assert.equal(babele.converters.ooExample.translate({
    value: "test",
    translation: null,
    source: {},
    field: "field",
    path: "field",
    params: {converter: "ooExample"},
    allTranslations: {},
    contextCompendium: null,
    runtime: {},
  }), "test oo");
});

test("Babel rejects configuration registrations after a session is installed", async () => {
  const babele = new Babel();

  game.settings.get = (_namespace, key) => {
    if (key === "language") {
      return "en";
    }
    if (key === "directory") {
      return "";
    }
    return "";
  };
  game.data.packs = [];
  foundry.applications.apps.FilePicker.browse = async () => ({files: []});

  await babele.init();

  assert.throws(
    () => babele.registerConverter("late", () => null),
    /must be called during the babele\.init hook/,
  );
  assert.throws(
    () => babele.register({module: "late-module", dir: "translations", lang: "en"}),
    /must be called during the babele\.init hook/,
  );
  assert.throws(
    () => babele.registerMapping({Item: {name: "name"}}),
    /must be called during the babele\.init hook/,
  );
});

test("Babel.converters exposes a frozen compatibility view", () => {
  const babele = new Babel();

  assert.throws(
    () => {
      babele.converters.document = null;
    },
    /read only|object is not extensible|Cannot assign|Cannot add property/i,
  );
  assert.equal(typeof babele.converterNamed("document")?.translate, "function");
});

test("Babel.exportDataFor hydrates journal pages from embedded documents when toObject omits them", async () => {
  const babele = new Babel();
  const pack = {
    collection: "test.journals",
    metadata: {
      id: "test.journals",
      label: "Journals",
    },
    folders: new foundry.utils.Collection(),
    async getIndex() {
      return [{_id: "journal-1"}];
    },
    async getDocument() {
      return {
        documentName: "JournalEntry",
        name: "Rules",
        toObject() {
          return {
            _id: "journal-1",
            name: "Rules",
          };
        },
        pages: {
          contents: [
            {
              toObject() {
                return {
                  _id: "page-1",
                  name: "Introduction",
                  text: {content: "<p>Hello</p>"},
                  image: {caption: ""},
                  video: {},
                };
              },
            },
          ],
        },
        categories: {
          contents: [],
        },
      };
    },
  };

  assignMappedCompendiums(babele, [[
    "test.journals",
    {
      translated: false,
      extract(data) {
        return {
          name: data.name,
          pages: {
            Introduction: {
              name: data.pages?.[0]?.name ?? null,
              text: data.pages?.[0]?.text?.content ?? null,
            },
          },
        };
      },
    },
  ]]);

  const exported = await babele.exportDataFor(pack, {format: "compatible", selection: "all"});

  assert.deepEqual(exported.entries, {
    Rules: {
      name: "Rules",
      pages: {
        Introduction: {
          name: "Introduction",
          text: "<p>Hello</p>",
        },
      },
    },
  });
});

test("Babel.reinitialize restores translated indexes and clears cached closed compendium documents", async () => {
  const babele = new Babel();
  let phase = 1;
  let clearCalls = 0;
  let initializeTreeCalls = 0;

  babele.register({module: "module-one", dir: "translations", lang: "en"});
  game.settings.get = (_namespace, key) => {
    if (key === "language") {
      return "en";
    }
    if (key === "directory") {
      return "";
    }
    return "";
  };
  foundry.applications.apps.FilePicker.browse = async (_source, dir) => {
    if (dir === "modules/module-one/translations") {
      return {
        files: ["modules/module-one/translations/module-one.items.json"],
      };
    }

    return {files: []};
  };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("module-one.items.json")) {
      return {
        async json() {
          return {
            label: phase === 1 ? "Oggetti" : "Armi",
            entries: {
              "item-1": {
                name: phase === 1 ? "Spada" : "Lama",
              },
            },
          };
        },
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  game.data.packs = [{
    type: "Item",
    packageName: "module-one",
    packageType: "module",
    name: "items",
  }];
  game.packs = new foundry.utils.Collection([[
    "module-one.items",
    {
      collection: "module-one.items",
      metadata: {id: "module-one.items", label: "Items"},
      index: [{_id: "item-1", name: "Sword"}],
      folders: new foundry.utils.Collection(),
      initializeTree() {
        initializeTreeCalls += 1;
      },
      clear() {
        clearCalls += 1;
      },
    },
  ]]);
  game.data.folders = [];
  game.collections.set("Folder", []);

  await babele.init();
  await babele.applyRuntimeTranslations();

  const entry = game.packs.get("module-one.items").index[0];
  const pack = game.packs.get("module-one.items");
  assert.equal(entry.name, "Spada");
  assert.equal(entry.originalName, "Sword");
  assert.equal(pack.metadata.label, "Oggetti");
  assert.equal(pack.metadata.originalLabel, "Items");

  phase = 2;
  await babele.reinitialize();

  assert.equal(entry.name, "Lama");
  assert.equal(entry.originalName, "Sword");
  assert.equal(pack.metadata.label, "Armi");
  assert.equal(pack.metadata.originalLabel, "Items");
  assert.equal(clearCalls >= 1, true);
  assert.equal(initializeTreeCalls >= 2, true);
});

test("Babel exposes cache diagnostics and explicit cache invalidation", async () => {
  const babele = new Babel();
  babele.register({module: "module-one", dir: "translations", lang: "en"});

  game.settings.get = (_namespace, key) => {
    if (key === "language") {
      return "en";
    }
    if (key === "directory") {
      return "";
    }
    return "";
  };
  foundry.applications.apps.FilePicker.browse = async (_source, dir) => {
    if (dir === "modules/module-one/translations") {
      return {
        files: ["modules/module-one/translations/module-one.items.json"],
      };
    }

    return {files: []};
  };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("module-one.items.json")) {
      return {
        async json() {
          return {
            entries: {
              "item-1": {
                name: "Spada",
              },
            },
          };
        },
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  game.data.packs = [{
    type: "Item",
    packageName: "module-one",
    packageType: "module",
    name: "items",
  }];
  game.packs = new foundry.utils.Collection([[
    "module-one.items",
    {
      collection: "module-one.items",
      metadata: {id: "module-one.items", label: "Items"},
      index: [{_id: "item-1", name: "Sword"}],
      folders: new foundry.utils.Collection(),
      initializeTree() {},
      clear() {},
    },
  ]]);
  game.data.folders = [];
  game.collections.set("Folder", []);

  await babele.init();
  await babele.applyRuntimeTranslations();
  game.packs.get("module-one.items").index[0].name = "Sword";
  delete game.packs.get("module-one.items").index[0].translated;
  babele.translateIndex(game.packs.get("module-one.items").index, "module-one.items");
  babele.translateIndex([{_id: "item-1", name: "Sword"}], "module-one.items");

  const before = babele.cacheDiagnostics();
  assert.equal(before.boundary, "babele-facade");
  assert.equal(before.language, "en");
  assert.equal(before.translationSources.translationSourcesCached, true);
  assert.equal(before.translationSources.mappingSourcesCached, true);
  assert.equal(before.translationSources.translationFileCount, 1);
  assert.equal(before.translationSources.mappingFileCount, 0);
  assert.equal(before.translationSources.sourcePriorityConfigured, false);
  assert.equal(before.session.mappedCompendiums.cachedIndexEntries, 1);
  assert.equal(before.session.mappedCompendiums.indexTranslationEntries, 1);
  assert.equal(before.session.mappedCompendiums.untranslatedPackCount, 0);
  assert.equal(before.session.mappedCompendiums.byDocumentType.Item.packCount, 1);
  assert.equal(before.session.documentMappings.strategy, "immutable-rebuild");
  assert.equal(before.session.documentMappings.documentTypes.includes("Item"), true);
  assert.equal(before.session.packFolderTranslations.packCount, 0);

  babele.invalidateCaches("test");

  const after = babele.cacheDiagnostics();
  assert.equal(after.translationSources.translationSourcesCached, true);
  assert.equal(after.translationSources.mappingSourcesCached, true);
  assert.equal(after.session.mappedCompendiums.cachedIndexEntries, 0);
  assert.equal(after.session.mappedCompendiums.indexTranslationEntries, 0);
});

test("Babel exposes source diagnostics and configurable source priority", async () => {
  const babele = new Babel();
  let storedPriority = {};
  game.settings.get = (_namespace, key) => {
    if (key === "language") {
      return "en";
    }
    if (key === "sourcePriority") {
      return storedPriority;
    }
    return "";
  };
  game.settings.set = async (_namespace, key, value) => {
    if (key === "sourcePriority") {
      storedPriority = value;
    }
  };

  await babele.setSourcePriority("test.items", ["module:two:en", "module:one:en"], {refresh: false});

  assert.deepEqual(babele.sourcePriority(), {
    global: [],
    collections: {
      "test.items": ["module:two:en", "module:one:en"],
    },
  });

  const diagnostics = await babele.sourceDiagnostics("en");
  assert.equal(diagnostics.language, "en");
});

test("Babel exposes on-demand actor translation proposal and apply API", async () => {
  const babele = new Babel();
  let applied = null;
  const actor = {
    items: {
      contents: [{
        id: "item-1",
        toObject() {
          return {_id: "item-1", name: "Sword"};
        },
      }],
    },
    async updateEmbeddedDocuments(documentType, updates) {
      applied = {documentType, updates};
    },
  };
  const translatedPack = {
    translated: true,
    hasTranslation(data, documentType) {
      return documentType === "Item" && data._id === "item-1";
    },
    translate(data) {
      return {...data, name: "Spada"};
    },
  };

  const babeleWithSession = await babeleWithFolderSession({
    mappedCompendiums: mockMappedCompendiums([["test.items", translatedPack]]),
  });

  const proposal = await babeleWithSession.proposeActorTranslation(actor);
  const updates = await babeleWithSession.applyActorTranslation(proposal);

  assert.deepEqual(proposal.summary(), {
    total: 1,
    ready: 1,
    modified: 0,
    translated: 0,
    untranslated: 0,
  });
  assert.deepEqual(updates, [
    {
      _id: "item-1",
      name: "Spada",
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
  assert.deepEqual(applied, {
    documentType: "Item",
    updates: [
      {
        _id: "item-1",
        name: "Spada",
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
    ],
  });
});

test("Babel.sourceDataForUuid loads source data from the document and ignores partial index data", async () => {
  const babele = new Babel();
  let indexCalled = false;
  game.packs = new foundry.utils.Collection([[
    "test.items",
    {
      collection: "test.items",
      async getIndex() {
        indexCalled = true;
        return [{
          _id: "item-1",
          name: "Sword",
          type: "weapon",
          flags: {
            babele: {
              originalPayload: {
                name: "Sword",
              },
            },
          },
        }];
      },
      async getDocument(id) {
        assert.equal(id, "item-1");
        return {
          toObject() {
            return {
              _id: "item-1",
              name: "Sword",
              type: "weapon",
              system: {
                description: {value: "Original description"},
              },
            };
          },
        };
      },
    },
  ]]);

  const source = await babele.sourceDataForUuid("Compendium.test.items.Item.item-1");

  assert.equal(indexCalled, false);
  assert.deepEqual(source, {
    _id: "item-1",
    name: "Sword",
    type: "weapon",
    system: {
      description: {value: "Original description"},
    },
  });
});

test("Babel.sourceDataForUuid loads document data without consulting the index", async () => {
  const babele = new Babel();
  game.packs = new foundry.utils.Collection([[
    "test.items",
    {
      collection: "test.items",
      async getIndex() {
        throw new Error("sourceDataForUuid must not read source data from the index");
      },
      async getDocument(id) {
        assert.equal(id, "item-1");
        return {
          toObject() {
            return {
              _id: "item-1",
              name: "Sword",
              type: "weapon",
              system: {
                description: {value: "Original description"},
              },
            };
          },
        };
      },
    },
  ]]);

  const source = await babele.sourceDataForUuid("Compendium.test.items.Item.item-1");

  assert.deepEqual(source, {
    _id: "item-1",
    name: "Sword",
    type: "weapon",
    system: {
      description: {value: "Original description"},
    },
  });
});

test("Babel.sourceDataForUuid rejects translated cached documents without original payload", async () => {
  const babele = new Babel();
  game.packs = new foundry.utils.Collection([[
    "test.items",
    {
      collection: "test.items",
      async getIndex() {
        throw new Error("sourceDataForUuid must not read source data from the index");
      },
      async getDocument() {
        return {
          toObject() {
            return {
              _id: "item-1",
              name: "Spada",
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
            };
          },
        };
      },
    },
  ]]);

  const source = await babele.sourceDataForUuid("Compendium.test.items.Item.item-1");

  assert.equal(source, null);
});

test.after(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  globalThis.fetch = originalFetch;
});
