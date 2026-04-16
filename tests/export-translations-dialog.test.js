import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {ExportTranslationsDialog} = await import("../module/script/export-translations-dialog.js");

test("ExportTranslationsDialog uses DialogV2 with compatible format as default", async () => {
  let templateContext = null;
  let dialogConfig = null;

  foundry.applications.handlebars.renderTemplate = async (_path, context) => {
    templateContext = context;
    return "<form></form>";
  };

  foundry.applications.api.DialogV2.input = async (config) => {
    dialogConfig = config;
    return {format: "compatible", selection: "all"};
  };

  const result = await ExportTranslationsDialog.create({
    metadata: {
      label: "Items",
    },
  }, {
    hasTranslations: true,
    counts: {
      all: 12,
      present: 7,
      missing: 5,
    },
  });

  assert.deepEqual(result, {format: "compatible", selection: "all"});
  assert.equal(templateContext.hasTranslations, true);
  assert.equal(templateContext.isCompatible, true);
  assert.equal(templateContext.isAll, true);
  assert.deepEqual(templateContext.counts, {all: 12, present: 7, missing: 5});
  assert.equal(templateContext.hasPresentEntries, true);
  assert.equal(templateContext.hasMissingEntries, true);
  assert.equal(dialogConfig.window.title, "Items: BABELE.ExportTranslationTitle");
  assert.equal(dialogConfig.position.width, 520);
  assert.equal(typeof dialogConfig.ok.callback, "function");
});
