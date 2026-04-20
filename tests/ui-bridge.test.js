import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";
import {FakeElement, installFakeDom} from "./helpers/fake-dom.js";

installFoundryStubs();
installFakeDom();

const {
  BabeleUiBridge,
  matchOriginalNameEntries,
} = await import("../module/script/ui/babele-ui-bridge.js");

function createCompendiumRoot() {
  const root = new FakeElement("section");
  const header = root.appendChild(new FakeElement("header"));
  const title = header.appendChild(new FakeElement("h4"));
  title.className = "window-title";
  title.textContent = "Compendium";

  const list = root.appendChild(new FakeElement("ol"));
  list.className = "directory-list";
  return {root, list};
}

function addCompendiumEntry(list, {entryId, nameClass = "entry-name", label}) {
  const row = list.appendChild(new FakeElement("li"));
  row.dataset.entryId = entryId;
  const name = row.appendChild(new FakeElement("h4"));
  name.className = nameClass;
  name.textContent = label;
  return {row, name};
}

test("BabeleUiBridge avoids duplicate ApplicationV1 actor header buttons", () => {
  const bridge = new BabeleUiBridge();
  const buttons = [];

  game.user.isGM = true;
  game.settings.get = (_namespace, key) => key === "showTranslateOption";

  bridge.extendLegacyActorSheetHeaderButtons({options: {editable: true}, actor: {name: "Actor"}}, buttons);
  bridge.extendLegacyActorSheetHeaderButtons({options: {editable: true}, actor: {name: "Actor"}}, buttons);

  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].class, "babele-translate-actor");
  assert.equal(buttons[0].icon, "fas fa-globe");
});

test("BabeleUiBridge avoids duplicate ApplicationV2 actor controls", () => {
  const bridge = new BabeleUiBridge();
  const controls = [];

  game.user.isGM = true;
  game.settings.get = (_namespace, key) => key === "showTranslateOption";

  bridge.extendActorSheetHeaderControls({isEditable: true, actor: {name: "Actor"}}, controls);
  bridge.extendActorSheetHeaderControls({isEditable: true, actor: {name: "Actor"}}, controls);

  assert.equal(controls.length, 1);
  assert.equal(controls[0].action, "babele-translate-actor");
});

test("BabeleUiBridge adds a single ApplicationV2 compendium export control", () => {
  const bridge = new BabeleUiBridge();
  const controls = [];

  game.user.isGM = true;
  game.settings.get = (_namespace, key) => key === "export";
  game.babele.exportTranslationsFile = () => {};

  bridge.extendCompendiumHeaderControls({collection: {collection: "test.pack"}}, controls);
  bridge.extendCompendiumHeaderControls({collection: {collection: "test.pack"}}, controls);

  assert.equal(controls.length, 1);
  assert.equal(controls[0].action, "babele-export-translations");
});

test("BabeleUiBridge decorates compendium entries by entry id without duplicating original-name labels", () => {
  const bridge = new BabeleUiBridge();
  const {root, list} = createCompendiumRoot();

  addCompendiumEntry(list, {
    entryId: "entry-1",
    label: "Translated Sword",
  });

  game.user.isGM = true;
  game.settings.get = (_namespace, key) => {
    if (key === "export") {
      return true;
    }
    if (key === "showOriginalName") {
      return true;
    }
    return false;
  };
  game.babele.exportTranslationsFile = () => {};

  const data = {
    collection: {
      index: [
        {
          _id: "entry-1",
          name: "Translated Sword",
          translated: true,
          hasTranslation: true,
          originalName: "Sword",
        },
      ],
    },
  };

  bridge.renderCompendium({collection: {collection: "test.pack"}}, root, data);
  bridge.renderCompendium({collection: {collection: "test.pack"}}, root, data);

  const originalNames = root.querySelectorAll(".babele-original-name");

  assert.equal(originalNames.length, 1);
  assert.equal(originalNames[0].textContent, "Sword");
});

test("BabeleUiBridge falls back to text lookup when compendium rows do not expose entry ids", () => {
  const bridge = new BabeleUiBridge();
  const {root, list} = createCompendiumRoot();

  const row = list.appendChild(new FakeElement("li"));
  const name = row.appendChild(new FakeElement("h4"));
  name.className = "document-name";
  name.textContent = "Translated Shield";

  game.user.isGM = false;
  game.settings.get = (_namespace, key) => key === "showOriginalName";

  bridge.renderCompendium({collection: {collection: "test.pack"}}, root, {
    collection: {
      index: [
        {
          _id: "entry-2",
          name: "Translated Shield",
          translated: true,
          hasTranslation: true,
          originalName: "Shield",
        },
      ],
    },
  });

  assert.equal(name.querySelector(".babele-original-name")?.textContent, "Shield");
});

test("BabeleUiBridge decorates anchor-based compendium entry names used by newer Foundry markup", () => {
  const bridge = new BabeleUiBridge();
  const {root, list} = createCompendiumRoot();

  const row = list.appendChild(new FakeElement("li"));
  row.className = "directory-item entry document item flexrow";
  row.dataset.entryId = "entry-3";

  const thumbnail = row.appendChild(new FakeElement("img"));
  thumbnail.className = "thumbnail";

  const name = row.appendChild(new FakeElement("a"));
  name.className = "entry-name ellipsis";
  name.textContent = "Dotazione da Avventuriero";

  game.settings.get = (_namespace, key) => key === "showOriginalName";

  bridge.renderCompendium({collection: {collection: "test.pack"}}, root, {
    collection: {
      index: [
        {
          _id: "entry-3",
          name: "Dotazione da Avventuriero",
          translated: true,
          hasTranslation: true,
          originalName: "Adventurer's Pack",
        },
      ],
    },
  });

  assert.equal(name.querySelector(".babele-original-name")?.textContent, "Adventurer's Pack");
  assert.equal(name.style.display, "flex");
  assert.equal(name.style.flexDirection, "column");
  assert.equal(name.style.whiteSpace, "normal");
});

test("BabeleUiBridge decorates entries when renderCompendium receives a subdirectory list as root", () => {
  const bridge = new BabeleUiBridge();
  const root = new FakeElement("ol");
  root.className = "subdirectory plain";

  const row = root.appendChild(new FakeElement("li"));
  row.className = "directory-item entry document item flexrow";
  row.dataset.entryId = "entry-4";

  const thumbnail = row.appendChild(new FakeElement("img"));
  thumbnail.className = "thumbnail";

  const name = row.appendChild(new FakeElement("a"));
  name.className = "entry-name ellipsis";
  name.textContent = "Dotazione da Diplomatico";

  game.settings.get = (_namespace, key) => key === "showOriginalName";

  bridge.renderCompendium({collection: {collection: "test.pack"}}, root, {
    collection: {
      index: [
        {
          _id: "entry-4",
          name: "Dotazione da Diplomatico",
          translated: true,
          hasTranslation: true,
          originalName: "Diplomat's Pack",
        },
      ],
    },
  });

  assert.equal(name.querySelector(".babele-original-name")?.textContent, "Diplomat's Pack");
});

test("BabeleUiBridge resolves translated entries from Collection-backed compendium indexes", () => {
  const bridge = new BabeleUiBridge();
  const root = new FakeElement("ol");
  root.className = "subdirectory plain";

  const row = root.appendChild(new FakeElement("li"));
  row.className = "directory-item entry document item flexrow";
  row.dataset.entryId = "entry-5";

  const name = row.appendChild(new FakeElement("a"));
  name.className = "entry-name ellipsis";
  name.textContent = "Spadone +1";

  game.settings.get = (_namespace, key) => key === "showOriginalName";

  bridge.renderCompendium({collection: {collection: "test.pack"}}, root, {
    collection: {
      index: new foundry.utils.Collection([[
        "entry-5",
        {
          id: "entry-5",
          name: "Spadone +1",
          translated: true,
          hasTranslation: true,
          originalName: "Greatsword +1",
        },
      ]]),
    },
  });

  assert.equal(name.querySelector(".babele-original-name")?.textContent, "Greatsword +1");
});

test("BabeleUiBridge matches original names during directory name search and expands parent folders", () => {
  globalThis.DIRECTORY_SEARCH_MODES = {NAME: "name", FULL: "full"};
  foundry.applications.ux = {
    SearchFilter: {
      cleanQuery(text) {
        return String(text).toLowerCase();
      },
    },
  };

  game.settings.get = (_namespace, key) => key === "showOriginalName";

  const entryIds = new Set();
  const folderIds = new Set();
  const autoExpandIds = new Set();
  const collection = {
    searchMode: "name",
    index: new foundry.utils.Collection([
      ["entry-6", {
        _id: "entry-6",
        name: "Spadone +1",
        originalName: "Greatsword +1",
        folder: "folder-a",
      }],
    ]),
    folders: new foundry.utils.Collection([
      ["folder-a", {_id: "folder-a", folder: "folder-root"}],
      ["folder-root", {_id: "folder-root"}],
    ]),
  };

  matchOriginalNameEntries(
    {collection},
    /greatsword/,
    entryIds,
    folderIds,
    autoExpandIds,
  );

  assert.deepEqual([...entryIds], ["entry-6"]);
  assert.deepEqual([...folderIds], ["folder-a", "folder-root"]);
  assert.deepEqual([...autoExpandIds], ["folder-a", "folder-root"]);
});

test("BabeleUiBridge original-name enrichment does not pull unrelated siblings from folders already matched by Foundry", () => {
  globalThis.DIRECTORY_SEARCH_MODES = {NAME: "name", FULL: "full"};
  foundry.applications.ux = {
    SearchFilter: {
      cleanQuery(text) {
        return String(text).toLowerCase();
      },
    },
  };

  game.settings.get = (_namespace, key) => key === "showOriginalName";

  const entryIds = new Set(["entry-translated"]);
  const folderIds = new Set(["folder-a"]);
  const autoExpandIds = new Set(["folder-a"]);
  const collection = {
    searchMode: "name",
    index: [
      {
        _id: "entry-translated",
        name: "Amuleto della Salute",
        originalName: "Amulet of Health",
        folder: "folder-a",
      },
      {
        _id: "entry-sibling",
        name: "Abiti, Costume",
        originalName: "Costume Clothes",
        folder: "folder-a",
      },
    ],
    folders: new foundry.utils.Collection([
      ["folder-a", {_id: "folder-a"}],
    ]),
  };

  matchOriginalNameEntries(
    {collection},
    /amuleto/,
    entryIds,
    folderIds,
    autoExpandIds,
  );

  assert.deepEqual([...entryIds], ["entry-translated"]);
});

test("BabeleUiBridge ignores original-name search enrichment outside name-only mode", () => {
  globalThis.DIRECTORY_SEARCH_MODES = {NAME: "name", FULL: "full"};
  foundry.applications.ux = {
    SearchFilter: {
      cleanQuery(text) {
        return String(text).toLowerCase();
      },
    },
  };

  game.settings.get = (_namespace, key) => key === "showOriginalName";

  const entryIds = new Set();
  const folderIds = new Set();
  const autoExpandIds = new Set();

  matchOriginalNameEntries(
    {
      collection: {
        searchMode: "full",
        index: [
          {
            _id: "entry-7",
            name: "Spada",
            flags: {
              babele: {
                originalName: "Sword",
              },
            },
          },
        ],
      },
    },
    /sword/,
    entryIds,
    folderIds,
    autoExpandIds,
  );

  assert.equal(entryIds.size, 0);
  assert.equal(folderIds.size, 0);
  assert.equal(autoExpandIds.size, 0);
});
