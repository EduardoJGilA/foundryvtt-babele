import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {registerModuleSettings} = await import("../module/script/settings.js");

test("registerModuleSettings refreshes sources without forcing a page reload", async () => {
  const registrations = new Map();
  let refreshCalls = 0;
  let reloadCalls = 0;

  game.settings.register = (_namespace, key, config) => {
    registrations.set(key, config);
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
  assert.equal(registrations.has("sourcesRevision"), true);

  registrations.get("directory").onChange("worlds/test/translations");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(refreshCalls, 1);
  assert.equal(reloadCalls, 0);
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
