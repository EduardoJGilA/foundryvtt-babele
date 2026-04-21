import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";
import {assignMappedCompendiums, assignPackFolderTranslations} from "./helpers/mapped-compendiums.js";

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
const {ExportTranslationsDialog} = await import("../module/script/ui/export-translations-dialog.js");

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

  const translations = babele.translations.values();

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

test("Babel.translateSystemPackFolders uses special _packs-folders translations from pack folders payload", () => {
  const babele = new Babel();
  const worldFolders = [
    {name: "Bestiary"},
    {name: "Rules"},
  ];

  assignPackFolderTranslations(babele, [[
    "test-system._packs-folders",
    {
      translations() {
        return {
          Bestiary: "Bestiario",
          Rules: "Regole",
        };
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

  assignMappedCompendiums(babele, [[
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

  assignMappedCompendiums(babele, [[
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

  assignMappedCompendiums(babele, [[
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

  assignMappedCompendiums(babele, [[
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
    assignMappedCompendiums(babele, [[
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

test.after(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  globalThis.fetch = originalFetch;
});
