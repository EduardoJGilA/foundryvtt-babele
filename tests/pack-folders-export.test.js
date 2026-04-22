import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {PackFoldersExport} = await import("../module/script/export/pack-folders-export.js");

test("PackFoldersExport groups compendium directory folders by package and sorts names", () => {
  game.packs = new foundry.utils.Collection([
    ["dnd5e.items", {
      metadata: {
        packageType: "system",
        packageName: "dnd5e",
      },
      folder: {
        name: "Items",
        folder: {
          name: "Core Rules",
          folder: null,
        },
      },
    }],
    ["dnd5e.spells", {
      metadata: {
        packageType: "system",
        packageName: "dnd5e",
      },
      folder: {
        name: "Spells",
        folder: {
          name: "Core Rules",
          folder: null,
        },
      },
    }],
    ["world.tables", {
      metadata: {
        packageType: "world",
        packageName: "ignored-world-id",
      },
      folder: {
        name: "World Content",
        folder: null,
      },
    }],
  ]);

  const exporter = new PackFoldersExport(game.babele);

  assert.deepEqual(exporter.availablePackages(), [
    {value: "dnd5e", label: "dnd5e", count: 3},
    {value: "world", label: "world", count: 1},
  ]);

  assert.deepEqual(exporter.data({selection: "all"}), [
    {
      packageId: "dnd5e",
      name: "dnd5e._packs-folders.json",
      payload: {
        entries: {
          "Core Rules": "Core Rules",
          "Items": "Items",
          "Spells": "Spells",
        },
      },
    },
    {
      packageId: "world",
      name: "world._packs-folders.json",
      payload: {
        entries: {
          "World Content": "World Content",
        },
      },
    },
  ]);
});

test("PackFoldersExport filters synthetic files by selected package", () => {
  game.packs = new foundry.utils.Collection([
    ["test.items", {
      metadata: {
        packageType: "module",
        packageName: "test-module",
      },
      folder: {
        name: "Equipment",
        folder: null,
      },
    }],
    ["other.items", {
      metadata: {
        packageType: "module",
        packageName: "other-module",
      },
      folder: {
        name: "Bestiary",
        folder: null,
      },
    }],
  ]);

  const exporter = new PackFoldersExport(game.babele);

  assert.deepEqual(exporter.data({selection: "test-module"}), [
    {
      packageId: "test-module",
      name: "test-module._packs-folders.json",
      payload: {
        entries: {
          Equipment: "Equipment",
        },
      },
    },
  ]);
});
