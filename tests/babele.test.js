import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

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
const {TranslatedCompendium} = await import("../module/script/translated-compendium.js");
const {ExportTranslationsDialog} = await import("../module/script/export-translations-dialog.js");

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

test("Babel prefers mappings.json over deprecated mapping.json in the same directory", async () => {
  const babele = new Babel();
  const originalItemMapping = structuredClone(Babel.DEFAULT_MAPPINGS.Item);
  babele.modules.push({module: "module-one", dir: "translations", lang: "en"});
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

  await babele.loadTranslations();

  assert.equal(Babel.DEFAULT_MAPPINGS.Item.canonical, "system.canonical");
  assert.equal(Babel.DEFAULT_MAPPINGS.Item.legacy, undefined);
  assert.equal(warnCalls.length, 1);
  assert.match(String(warnCalls[0][0]), /both 'mappings\.json' and deprecated 'mapping\.json'/);

  Babel.DEFAULT_MAPPINGS.Item = originalItemMapping;
});

test("Babel.loadTranslations logs and skips invalid translation JSON files", async () => {
  const babele = new Babel();
  babele.modules.push(
    {module: "module-one", dir: "translations", lang: "en"},
    {module: "module-two", dir: "translations", lang: "en"},
  );

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

  const translations = await babele.loadTranslations();

  assert.equal(translations.length, 1);
  assert.equal(translations[0].collection, "module-one.items");
  assert.deepEqual(translations[0].entries, {sword: {name: "Sword"}});
  assert.equal(errorCalls.length, 1);
  assert.match(String(errorCalls[0][0]), /failed to load translation file/);
  assert.equal(errorCalls[0][1].kind, "translation");
  assert.equal(errorCalls[0][1].collection, "module-one.items");
  assert.equal(errorCalls[0][1].file, "modules/module-one/translations/module-one.items.json");
  assert.match(String(errorCalls[0][1].error), /invalid translation JSON/);
});

test("Babel.loadTranslations logs and skips invalid mapping JSON files", async () => {
  const babele = new Babel();
  const originalItemMapping = structuredClone(Babel.DEFAULT_MAPPINGS.Item);
  babele.modules.push(
    {module: "module-one", dir: "translations", lang: "en"},
    {module: "module-two", dir: "translations", lang: "en"},
  );

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

  await babele.loadTranslations();

  assert.equal(Babel.DEFAULT_MAPPINGS.Item.structured, "system.structured");
  assert.equal(errorCalls.length, 1);
  assert.match(String(errorCalls[0][0]), /failed to load mapping file/);
  assert.equal(errorCalls[0][1].kind, "mapping");
  assert.equal(errorCalls[0][1].phase, "global defaults enrichment");
  assert.equal(errorCalls[0][1].file, "modules/module-one/translations/mappings.json");
  assert.match(String(errorCalls[0][1].error), /mapping fetch failed/);

  Babel.DEFAULT_MAPPINGS.Item = originalItemMapping;
});

test("Babel.reinitialize replaces loaded global mappings instead of accumulating them", async () => {
  const babele = new Babel();
  const originalItemMapping = structuredClone(Babel.DEFAULT_MAPPINGS.Item);
  let phase = 1;

  babele.modules.push({module: "module-one", dir: "translations", lang: "en"});
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
  assert.equal(Babel.DEFAULT_MAPPINGS.Item.phaseOne, "system.phaseOne");
  assert.equal(Babel.DEFAULT_MAPPINGS.Item.phaseTwo, undefined);

  phase = 2;
  await babele.reinitialize();

  assert.equal(Babel.DEFAULT_MAPPINGS.Item.phaseOne, undefined);
  assert.equal(Babel.DEFAULT_MAPPINGS.Item.phaseTwo, "system.phaseTwo");

  Babel.DEFAULT_MAPPINGS.Item = originalItemMapping;
});

test("Babel.translate fails open for translated packs when a converter throws", () => {
  const babele = new Babel();
  const originalConverter = game.babele.converters.explode;

  game.babele.converters.explode = () => {
    throw new Error("import converter boom");
  };

  const tc = new TranslatedCompendium({
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
  });

  babele.packs = new foundry.utils.Collection([["test.actors", tc]]);

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

  if (typeof originalConverter === "undefined") {
    delete game.babele.converters.explode;
  } else {
    game.babele.converters.explode = originalConverter;
  }
});

test("Babel.translateSystemPackFolders uses special _packs-folders translations from pack folders payload", () => {
  const babele = new Babel();
  const worldFolders = [
    {name: "Bestiary"},
    {name: "Rules"},
  ];

  babele.packs = new foundry.utils.Collection([[
    "test-system._packs-folders",
    {
      metadata: {
        name: "_packs-folders",
      },
      translations: {
        Bestiary: "Bestiario",
      },
      folders: {
        Rules: "Regole",
      },
    },
  ]]);

  game.data.folders = worldFolders;
  game.collections.set("Folder", worldFolders);

  babele.translateSystemPackFolders();

  assert.equal(worldFolders[0].name, "Bestiario");
  assert.equal(worldFolders[1].name, "Regole");
});

test("Babel.translatePackFolders uses the compendium translation folders payload", () => {
  const babele = new Babel();
  const pack = {
    metadata: {
      id: "test.items",
    },
    folders: new foundry.utils.Collection([
      ["folder-a", {name: "Equipment"}],
      ["folder-b", {name: "Treasure"}],
    ]),
  };

  babele.packs = new foundry.utils.Collection([[
    "test.items",
    {
      folders: {
        Equipment: "Equipaggiamento",
      },
    },
  ]]);

  babele.translatePackFolders(pack);

  assert.equal(pack.folders.get("folder-a").name, "Equipaggiamento");
  assert.equal(pack.folders.get("folder-b").name, "Treasure");
});

test("Babel.translateImportedCompendiumFolder uses the source pack folder translations", () => {
  const babele = new Babel();
  const folder = {
    id: "folder-a",
    name: "Equipment",
    _stats: {
      compendiumSource: "Compendium.test.items.Folder.folder-a",
    },
  };

  babele.packs = new foundry.utils.Collection([[
    "test.items",
    {
      folders: {
        Equipment: "Equipaggiamento",
      },
    },
  ]]);

  babele.translateImportedCompendiumFolder(folder);

  assert.equal(folder.originalName, "Equipment");
  assert.equal(folder.name, "Equipaggiamento");
});

test("Babel.translateImportedCompendiumFolder falls back to matching the imported folder id against source pack folders", () => {
  const babele = new Babel();
  const folder = {
    id: "folder-a",
    name: "Equipment",
    type: "Item",
  };

  babele.packs = new foundry.utils.Collection([[
    "test.items",
    {
      folders: {
        Equipment: "Equipaggiamento",
      },
    },
  ]]);

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

test("Babel.translateImportedCompendiumFolders reapplies translations to imported world folders", () => {
  const babele = new Babel();
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

  babele.packs = new foundry.utils.Collection([[
    "test.items",
    {
      folders: {
        Equipment: "Equipaggiamento",
      },
    },
  ]]);

  babele.translateImportedCompendiumFolders(worldFolders);

  assert.equal(worldFolders.get("folder-a").name, "Equipaggiamento");
  assert.equal(worldFolders.get("folder-a").originalName, "Equipment");
  assert.equal(worldFolders.get("folder-b").name, "Rules");
});

test("Babel.exportTranslationsFile includes compendium folders using original names", async () => {
  const babele = new Babel();
  const originalDialogCreate = ExportTranslationsDialog.create;
  const originalZip = globalThis.JSZip;
  const originalSaveAs = globalThis.saveAs;
  const originalInfo = globalThis.ui.notifications.info;
  let dialogOptions = null;
  let savedContent = null;
  let savedName = null;
  let zipInstance = null;
  const progressCalls = [];

  try {
    ExportTranslationsDialog.create = async (_pack, options) => {
      dialogOptions = options;
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
    babele.packs = new foundry.utils.Collection([[
      "test.items",
      {
        folders: {
          Equipment: "Equipaggiamento",
        },
      },
    ]]);
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
    ExportTranslationsDialog.create = originalDialogCreate;
    globalThis.JSZip = originalZip;
    globalThis.saveAs = originalSaveAs;
    globalThis.ui.notifications.info = originalInfo;
  }
});

test("Babel.exportTranslationsFile computes dialog counts from the index without loading documents before confirmation", async () => {
  const babele = new Babel();
  const originalDialogCreate = ExportTranslationsDialog.create;
  let getDocumentCalls = 0;
  let dialogOptions = null;

  try {
    ExportTranslationsDialog.create = async (_pack, options) => {
      dialogOptions = options;
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

    babele.packs = new foundry.utils.Collection([[
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
    ExportTranslationsDialog.create = originalDialogCreate;
  }
});

test("Babel.exportTranslationsFile computes dialog counts correctly from Collection-backed indexes", async () => {
  const babele = new Babel();
  const originalDialogCreate = ExportTranslationsDialog.create;
  let dialogOptions = null;

  try {
    ExportTranslationsDialog.create = async (_pack, options) => {
      dialogOptions = options;
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

    babele.packs = new foundry.utils.Collection([[
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
    ExportTranslationsDialog.create = originalDialogCreate;
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

  babele.packs = new foundry.utils.Collection([[
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

  babele.packs = new foundry.utils.Collection([[
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

test("Babel.registerConverter normalizes legacy functions and OO converters to the internal OO contract", () => {
  const babele = new Babel();

  const legacy = (value) => `${value} legacy`;
  legacy.extract = (value) => ({value});

  const ooConverter = {
    translate(context) {
      return `${context.value} oo`;
    },
    extract(context) {
      return {value: context.value};
    },
    isDynamic() {
      return true;
    },
  };

  babele.registerConverter("legacyExample", legacy);
  babele.registerConverter("ooExample", ooConverter);

  assert.equal(typeof babele.converters.legacyExample.translate, "function");
  assert.equal(typeof babele.converters.legacyExample.extract, "function");
  assert.equal(babele.converters.legacyExample.isDynamic(), true);
  assert.equal(babele.converters.legacyExample.translate({
    value: "test",
    translation: null,
    source: {},
    field: "field",
    path: "field",
    params: {converter: "legacyExample"},
    allTranslations: {},
    contextCompendium: null,
    runtime: {},
  }), "test legacy");

  assert.equal(typeof babele.converters.ooExample.translate, "function");
  assert.equal(typeof babele.converters.ooExample.extract, "function");
  assert.equal(babele.converters.ooExample.isDynamic(), true);
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

  babele.packs = new foundry.utils.Collection([[
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

  babele.modules.push({module: "module-one", dir: "translations", lang: "en"});
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
      metadata: {id: "module-one.items"},
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
  assert.equal(entry.name, "Spada");
  assert.equal(entry.originalName, "Sword");

  phase = 2;
  await babele.reinitialize();

  assert.equal(entry.name, "Lama");
  assert.equal(entry.originalName, "Sword");
  assert.equal(clearCalls >= 1, true);
  assert.equal(initializeTreeCalls >= 2, true);
});

test.after(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  globalThis.fetch = originalFetch;
});
