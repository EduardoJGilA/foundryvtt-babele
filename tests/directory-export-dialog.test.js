import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {DirectoryExportDialog} = await import("../module/script/ui/directory-export-dialog.js");

test("DirectoryExportDialog uses DialogV2 and collects selected packs", async () => {
  let templateContext = null;
  let dialogConfig = null;

  foundry.applications.handlebars.renderTemplate = async (_path, context) => {
    templateContext = context;
    return "<form></form>";
  };

  foundry.applications.api.DialogV2.input = async (config) => {
    dialogConfig = config;
    return {
      includeCompendiums: true,
      includePackFolders: true,
      packMode: "selected",
      packs: ["test.items"],
      format: "compatible",
      selection: "all",
    };
  };

  const result = await new DirectoryExportDialog([
    {collection: "test.items", label: "Items", packageId: "test", count: 2},
  ], {
    packages: [{value: "test", label: "test", count: 3}],
    packMode: "selected",
    packageMode: "selected",
    selectedPacks: ["test.items"],
    selectedPackageIds: ["test"],
  }).prompt();

  assert.equal(templateContext.isSelectedPacks, true);
  assert.equal(templateContext.hasPacks, true);
  assert.equal(templateContext.isSelectedPackages, true);
  assert.equal(templateContext.hasPackages, true);
  assert.deepEqual(templateContext.packs, [
    {collection: "test.items", label: "Items", packageId: "test", count: 2, checked: true},
  ]);
  assert.deepEqual(templateContext.packages, [
    {value: "test", label: "test", count: 3, checked: true},
  ]);
  assert.equal(dialogConfig.window.title, "BABELE.ExportDirectoryTitle");
  assert.equal(dialogConfig.position.width, 860);
  assert.deepEqual(result, {
    includeCompendiums: true,
    includePackFolders: true,
    packMode: "selected",
    packs: ["test.items"],
    format: "compatible",
    selection: "all",
  });
});
