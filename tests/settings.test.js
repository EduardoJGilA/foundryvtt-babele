import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {registerModuleSettings} = await import("../module/script/foundry/settings.js");

test("registerModuleSettings refreshes sources without forcing a page reload", async () => {
  const registrations = new Map();
  const menus = new Map();
  let refreshCalls = 0;
  let reloadCalls = 0;

  game.settings.register = (_namespace, key, config) => {
    registrations.set(key, config);
  };
  game.settings.registerMenu = (_namespace, key, config) => {
    menus.set(key, config);
  };
  game.user.isGM = true;
  game.babele.refreshTranslationSources = async () => {
    refreshCalls += 1;
  };
  window.location = {};
  window.location.reload = () => {
    reloadCalls += 1;
  };

  registerModuleSettings();

  assert.equal(registrations.has("directory"), true);
  assert.equal(registrations.has("sourcePriority"), true);
  assert.equal(registrations.has("sourcesRevision"), true);
  assert.equal(registrations.has("warnMissingPaths"), true);
  assert.equal(menus.has("sourcePriorityMenu"), true);
  assert.equal(menus.get("sourcePriorityMenu").restricted, true);
  assert.equal(menus.get("sourcePriorityMenu").type.name, "SourcePrioritySettings");

  registrations.get("directory").onChange("worlds/test/translations");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(refreshCalls, 1);
  assert.equal(reloadCalls, 0);
});

test("sourcePriority setting refreshes sources for GMs", async () => {
  const registrations = new Map();
  let refreshCalls = 0;

  game.settings.register = (_namespace, key, config) => {
    registrations.set(key, config);
  };
  game.user.isGM = true;
  game.babele.refreshTranslationSources = async () => {
    refreshCalls += 1;
  };

  registerModuleSettings();

  registrations.get("sourcePriority").onChange({});
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(registrations.get("sourcePriority").scope, "world");
  assert.equal(registrations.get("sourcePriority").config, false);
  assert.deepEqual(registrations.get("sourcePriority").default, {});
  assert.equal(refreshCalls, 1);
});

test("sourcesRevision change triggers non-GM reinitialization", async () => {
  const registrations = new Map();
  let reinitializeCalls = 0;

  game.settings.register = (_namespace, key, config) => {
    registrations.set(key, config);
  };
  game.user.isGM = false;
  game.babele.reinitialize = async () => {
    reinitializeCalls += 1;
  };

  registerModuleSettings();

  registrations.get("sourcesRevision").onChange(Date.now());
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(reinitializeCalls, 1);
});

test("warnMissingPaths defaults to disabled client diagnostics", () => {
  const registrations = new Map();

  game.settings.register = (_namespace, key, config) => {
    registrations.set(key, config);
  };

  registerModuleSettings();

  assert.equal(registrations.get("warnMissingPaths").scope, "client");
  assert.equal(registrations.get("warnMissingPaths").default, false);
  assert.equal(registrations.get("warnMissingPaths").config, true);
});
