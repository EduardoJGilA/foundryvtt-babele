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

console.log = (...args) => logCalls.push(args);
console.warn = (...args) => warnCalls.push(args);
console.error = (...args) => errorCalls.push(args);

const {Babel} = await import("../module/script/babele.js");

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

test.after(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});
