import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {ExportPackFoldersDialog} = await import("../module/script/ui/export-pack-folders-dialog.js");

test("ExportPackFoldersDialog uses DialogV2 with package selection", async () => {
  let templateContext = null;
  let dialogConfig = null;

  foundry.applications.handlebars.renderTemplate = async (_path, context) => {
    templateContext = context;
    return "<form></form>";
  };

  foundry.applications.api.DialogV2.input = async (config) => {
    dialogConfig = config;
    return {selection: "all"};
  };

  const result = await new ExportPackFoldersDialog([
    {value: "dnd5e", label: "dnd5e", count: 4},
  ]).prompt();

  assert.deepEqual(result, {selection: "all"});
  assert.equal(templateContext.isAll, true);
  assert.equal(templateContext.hasPackages, true);
  assert.deepEqual(templateContext.packages, [
    {value: "dnd5e", label: "dnd5e", count: 4, selected: false},
  ]);
  assert.equal(dialogConfig.window.title, "BABELE.ExportPackFoldersTitle");
  assert.equal(dialogConfig.position.width, 520);
});
