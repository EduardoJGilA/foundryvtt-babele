import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";
import {assignMappedCompendiums} from "./helpers/mapped-compendiums.js";

installFoundryStubs();

const {default: Babel} = await import("../module/script/babele.js");
const {DirectoryExport} = await import("../module/script/export/directory-export.js");
const {DirectoryExportDialog} = await import("../module/script/ui/directory-export-dialog.js");

test("DirectoryExport bulk-exports all compendiums and related _packs-folders files", async () => {
  const babele = new Babel();

  game.packs = new foundry.utils.Collection([
    ["test.items", {
      collection: "test.items",
      metadata: {
        id: "test.items",
        label: "Items",
        packageType: "module",
        packageName: "test",
      },
      folder: {
        name: "Equipment",
        folder: null,
      },
      async getIndex() {
        return [{_id: "item-1"}];
      },
      async getDocument() {
        return {_id: "item-1", name: "Sword"};
      },
      folders: new foundry.utils.Collection(),
    }],
    ["test.spells", {
      collection: "test.spells",
      metadata: {
        id: "test.spells",
        label: "Spells",
        packageType: "module",
        packageName: "test",
      },
      folder: {
        name: "Spells",
        folder: null,
      },
      async getIndex() {
        return [{_id: "spell-1"}];
      },
      async getDocument() {
        return {_id: "spell-1", name: "Magic Missile"};
      },
      folders: new foundry.utils.Collection(),
    }],
  ]);

  babele.extract = (_pack, data) => ({name: data.name});
  assignMappedCompendiums(babele, [
    ["test.items", {translated: false}],
    ["test.spells", {translated: false}],
  ]);

  const exporter = new DirectoryExport(babele);
  const files = await exporter.data({
    includeCompendiums: true,
    includePackFolders: true,
    packMode: "all",
    format: "compatible",
    selection: "all",
  });

  assert.deepEqual(files.map((file) => file.name), [
    "test._packs-folders.json",
    "test.items.json",
    "test.spells.json",
  ]);
});

test("DirectoryExport exports only selected compendiums and scopes _packs-folders to their packages", async () => {
  const babele = new Babel();

  game.packs = new foundry.utils.Collection([
    ["test.items", {
      collection: "test.items",
      metadata: {
        id: "test.items",
        label: "Items",
        packageType: "module",
        packageName: "test",
      },
      folder: {
        name: "Equipment",
        folder: null,
      },
      async getIndex() {
        return [{_id: "item-1"}];
      },
      async getDocument() {
        return {_id: "item-1", name: "Sword"};
      },
      folders: new foundry.utils.Collection(),
    }],
    ["other.items", {
      collection: "other.items",
      metadata: {
        id: "other.items",
        label: "Other Items",
        packageType: "module",
        packageName: "other",
      },
      folder: {
        name: "Bestiary",
        folder: null,
      },
      async getIndex() {
        return [{_id: "item-2"}];
      },
      async getDocument() {
        return {_id: "item-2", name: "Shield"};
      },
      folders: new foundry.utils.Collection(),
    }],
  ]);

  babele.extract = (_pack, data) => ({name: data.name});
  assignMappedCompendiums(babele, [
    ["test.items", {translated: false}],
    ["other.items", {translated: false}],
  ]);

  const exporter = new DirectoryExport(babele);
  const files = await exporter.data({
    includeCompendiums: true,
    includePackFolders: true,
    packMode: "selected",
    packs: ["other.items"],
    packageMode: "selected",
    packageIds: ["other"],
    format: "compatible",
    selection: "all",
  });

  assert.deepEqual(files.map((file) => file.name), [
    "other._packs-folders.json",
    "other.items.json",
  ]);
});

test("DirectoryExport exports only selected synthetic _packs-folders packages when requested", async () => {
  const babele = new Babel();

  game.packs = new foundry.utils.Collection([
    ["test.items", {
      collection: "test.items",
      metadata: {
        id: "test.items",
        label: "Items",
        packageType: "module",
        packageName: "test",
      },
      folder: {
        name: "Equipment",
        folder: null,
      },
      folders: new foundry.utils.Collection(),
    }],
    ["other.items", {
      collection: "other.items",
      metadata: {
        id: "other.items",
        label: "Other Items",
        packageType: "module",
        packageName: "other",
      },
      folder: {
        name: "Bestiary",
        folder: null,
      },
      folders: new foundry.utils.Collection(),
    }],
  ]);

  assignMappedCompendiums(babele, [
    ["test.items", {translated: false}],
    ["other.items", {translated: false}],
  ]);

  const exporter = new DirectoryExport(babele);
  const files = await exporter.data({
    includeCompendiums: false,
    includePackFolders: true,
    packageMode: "selected",
    packageIds: ["test"],
  });

  assert.deepEqual(files.map((file) => file.name), [
    "test._packs-folders.json",
  ]);
});

test("DirectoryExport.download shows progress while generating the bulk zip", async () => {
  const babele = new Babel();
  const originalPrompt = DirectoryExportDialog.prototype.prompt;
  const originalZip = globalThis.JSZip;
  const originalSaveAs = globalThis.saveAs;
  const originalInfo = globalThis.ui.notifications.info;
  const progressCalls = [];
  let savedName = null;
  let savedContent = null;
  let zipInstance = null;

  try {
    game.packs = new foundry.utils.Collection([
      ["test.items", {
        collection: "test.items",
        metadata: {
          id: "test.items",
          label: "Items",
          packageType: "module",
          packageName: "test",
        },
        folder: {
          name: "Equipment",
          folder: null,
        },
        async getIndex() {
          return [{_id: "item-1"}];
        },
        async getDocument() {
          return {_id: "item-1", name: "Sword"};
        },
        folders: new foundry.utils.Collection(),
      }],
    ]);

    babele.extract = (_pack, data) => ({name: data.name});
    assignMappedCompendiums(babele, [["test.items", {translated: false}]]);

    DirectoryExportDialog.prototype.prompt = async () => ({
      includeCompendiums: true,
      includePackFolders: true,
      packMode: "all",
      packageMode: "all",
      format: "compatible",
      selection: "all",
    });

    globalThis.ui.notifications.info = (message, options) => {
      progressCalls.push({message, options});
      return {
        update(update) {
          progressCalls.push({update});
        },
      };
    };

    globalThis.JSZip = class {
      constructor() {
        this.files = {};
        zipInstance = this;
      }

      file(name, content) {
        this.files[name] = content;
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

    const exporter = new DirectoryExport(babele);
    await exporter.download();

    assert.deepEqual(progressCalls[0], {
      message: "Babele | Preparing directory export",
      options: {progress: true, console: false},
    });
    assert.deepEqual(progressCalls.at(-1), {
      update: {message: "Babele | Packaging directory zip", pct: 1},
    });
    assert.ok(progressCalls.some((entry) =>
      entry.update?.message === "Babele | Preparing directory export (0/2)"
      && entry.update.pct === 0.01
    ));
    assert.ok(progressCalls.some((entry) =>
      entry.update?.message === "Babele | Preparing directory export (2/2)"
      && entry.update.pct > 0.01
    ));
    assert.ok(progressCalls.some((entry) =>
      entry.update?.message === "Babele | Packaging directory zip"
      && entry.update.pct > 0.72
      && entry.update.pct < 1
    ));
    assert.equal(savedName, "babele-directory-export.zip");
    assert.equal(savedContent, zipInstance.files);
  } finally {
    DirectoryExportDialog.prototype.prompt = originalPrompt;
    globalThis.JSZip = originalZip;
    globalThis.saveAs = originalSaveAs;
    globalThis.ui.notifications.info = originalInfo;
  }
});
