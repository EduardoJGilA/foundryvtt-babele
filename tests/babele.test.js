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

const {Babel} = await import("../module/script/babele.js");

test.beforeEach(() => {
  logCalls.length = 0;
  warnCalls.length = 0;
  errorCalls.length = 0;
});

test("Babel.init fails open and can retry after a bootstrap failure", async () => {
  const babele = new Babel();
  let attempts = 0;

  babele.loadTranslations = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("boom");
    }
    return [];
  };

  const first = await babele.init();
  const second = await babele.init();

  assert.equal(first, false);
  assert.equal(second, true);
  assert.equal(attempts, 2);
  assert.equal(errorCalls.length >= 1, true);
  assert.match(String(errorCalls[0][0]), /initialization failed during step/);
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

test.after(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  globalThis.fetch = originalFetch;
});
