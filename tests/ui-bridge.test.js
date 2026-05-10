import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";
import {FakeElement, installFakeDom} from "./helpers/fake-dom.js";

installFoundryStubs();
installFakeDom();

const {
  BabeleUiBridge,
  appendOriginalNamesToDocumentMatches,
  matchOriginalNameEntries,
  matchOriginalDocumentEntries,
  matchOriginalPackTitles,
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

test("BabeleUiBridge injects a single compendium-directory export button", () => {
  const bridge = new BabeleUiBridge();
  const root = new FakeElement("section");
  const header = root.appendChild(new FakeElement("div"));
  header.className = "header-actions action-buttons";

  let calls = 0;
  game.user.isGM = true;
  game.settings.get = (_namespace, key) => key === "export";
  game.babele.exportDirectoryTranslations = () => { calls += 1; };

  bridge.extendCompendiumDirectoryControls({}, root);
  bridge.extendCompendiumDirectoryControls({}, root);

  const buttons = root.querySelectorAll(".babele-export-pack-folders");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].dataset.action, "babele-export-pack-folders");

  buttons[0].listeners.get("click")();
  assert.equal(calls, 1);
});

test("BabeleUiBridge decorates compendium sidebar pack titles with original names", () => {
  const bridge = new BabeleUiBridge();
  const root = new FakeElement("section");
  const row = root.appendChild(new FakeElement("li"));
  row.dataset.pack = "test.pack";

  const name = row.appendChild(new FakeElement("h4"));
  name.className = "entry-name";
  name.textContent = "Compendio Tradotto";

  game.packs = new foundry.utils.Collection([[
    "test.pack",
    {
      collection: "test.pack",
      metadata: {
        originalLabel: "Original Compendium",
      },
    },
  ]]);
  game.settings.get = (_namespace, key) => key === "showOriginalName";

  bridge.renderCompendiumDirectory({}, root);

  assert.equal(name.querySelector(".babele-original-name")?.textContent, "Original Compendium");
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

  game.settings.get = (_namespace, key) => key === "searchOriginalName";

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

test("BabeleUiBridge matches original names during directory search even when original-name hints are hidden", () => {
  globalThis.DIRECTORY_SEARCH_MODES = {NAME: "name", FULL: "full"};
  foundry.applications.ux = {
    SearchFilter: {
      cleanQuery(text) {
        return String(text).toLowerCase();
      },
    },
  };

  game.settings.get = (_namespace, key) => key === "searchOriginalName";

  const entryIds = new Set();
  const folderIds = new Set();
  const autoExpandIds = new Set();

  matchOriginalNameEntries(
    {
      collection: {
        searchMode: "name",
        index: [
          {
            _id: "entry-8",
            name: "Benediction",
            originalName: "Bless",
          },
        ],
      },
    },
    /bless/,
    entryIds,
    folderIds,
    autoExpandIds,
  );

  assert.deepEqual([...entryIds], ["entry-8"]);
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

  game.settings.get = (_namespace, key) => key === "searchOriginalName";

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

  game.settings.get = (_namespace, key) => key === "searchOriginalName";

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

test("BabeleUiBridge skips original-name search enrichment when the dedicated setting is disabled", () => {
  globalThis.DIRECTORY_SEARCH_MODES = {NAME: "name", FULL: "full"};
  foundry.applications.ux = {
    SearchFilter: {
      cleanQuery(text) {
        return String(text).toLowerCase();
      },
    },
  };

  game.settings.get = () => false;

  const entryIds = new Set();
  const folderIds = new Set();
  const autoExpandIds = new Set();

  matchOriginalNameEntries(
    {
      collection: {
        searchMode: "name",
        index: [
          {
            _id: "entry-9",
            name: "Benediction",
            originalName: "Bless",
          },
        ],
      },
    },
    /bless/,
    entryIds,
    folderIds,
    autoExpandIds,
  );

  assert.equal(entryIds.size, 0);
});

test("BabeleUiBridge matches original compendium titles in the sidebar when enabled", () => {
  foundry.applications.ux = {
    SearchFilter: {
      cleanQuery(text) {
        return String(text).toLowerCase();
      },
    },
  };

  game.settings.get = (_namespace, key) => key === "searchOriginalName";
  game.packs = [
    {
      collection: "test.pack",
      metadata: {
        originalLabel: "Original Compendium",
      },
      folder: "folder-a",
    },
  ];

  const packIds = new Set();
  const folderIds = new Set();
  const autoExpandIds = new Set();

  matchOriginalPackTitles({}, /original compendium/, packIds, folderIds, autoExpandIds);

  assert.deepEqual([...packIds], ["test.pack"]);
});

test("BabeleUiBridge matches original names for compendium sidebar document results", () => {
  foundry.applications.ux = {
    SearchFilter: {
      cleanQuery(text) {
        return String(text).toLowerCase();
      },
    },
  };

  game.settings.get = (_namespace, key) => key === "searchOriginalName";
  game.packs = [
    {
      collection: "dnd5e.spells",
      documentName: "Item",
      index: [
        {
          _id: "spell-1",
          name: "Bagou",
          originalName: "Friends",
          img: "icons/svg/book.svg",
        },
      ],
    },
  ];

  const documents = new Set();
  matchOriginalDocumentEntries({activeFilters: new Set()}, "friends", documents);

  const [entry] = [...documents];
  assert.equal(entry?.uuid, "Compendium.dnd5e.spells.Item.spell-1");
  assert.equal(entry?.originalName, "Friends");
});

test("BabeleUiBridge matches more than one original-name sidebar document result", () => {
  foundry.applications.ux = {
    SearchFilter: {
      cleanQuery(text) {
        return String(text).toLowerCase();
      },
    },
  };

  game.settings.get = (_namespace, key) => key === "searchOriginalName";
  game.packs = [
    {
      collection: "dnd5e.spells",
      documentName: "Item",
      index: [
        {
          _id: "spell-1",
          name: "Bagou",
          originalName: "Friends",
        },
        {
          _id: "spell-2",
          name: "Amitie renforcee",
          originalName: "Friendly Word",
        },
      ],
    },
  ];

  const documents = new Set();
  matchOriginalDocumentEntries({activeFilters: new Set()}, "fri", documents);

  assert.equal(documents.size, 2);
  assert.deepEqual(
    [...documents].map((entry) => entry.uuid),
    [
      "Compendium.dnd5e.spells.Item.spell-1",
      "Compendium.dnd5e.spells.Item.spell-2",
    ],
  );
});

test("BabeleUiBridge sidebar original-name search uses word-prefix matching", () => {
  foundry.applications.ux = {
    SearchFilter: {
      cleanQuery(text) {
        return String(text).toLowerCase();
      },
    },
  };

  game.settings.get = (_namespace, key) => key === "searchOriginalName";
  game.packs = [
    {
      collection: "dnd5e.items",
      documentName: "Item",
      index: [
        {
          _id: "wand-1",
          name: "Baguette des merveilles",
          originalName: "Wand of Wonder",
        },
        {
          _id: "wand-2",
          name: "Baguette de feu",
          originalName: "Wand of Fireballs",
        },
        {
          _id: "swan-1",
          name: "Bateau-cygne",
          originalName: "Swan Boat",
        },
      ],
    },
  ];

  const documents = new Set();
  matchOriginalDocumentEntries({activeFilters: new Set()}, "wand", documents);

  assert.deepEqual(
    [...documents].map((entry) => entry.uuid),
    [
      "Compendium.dnd5e.items.Item.wand-1",
      "Compendium.dnd5e.items.Item.wand-2",
    ],
  );
});

test("BabeleUiBridge decorates compendium sidebar document matches with original names", () => {
  const root = new FakeElement("section");
  const row = root.appendChild(new FakeElement("li"));
  row.dataset.documentMatch = "";
  row.dataset.uuid = "Compendium.dnd5e.spells.Item.spell-1";

  const name = row.appendChild(new FakeElement("a"));
  name.dataset.name = "";
  name.className = "name";
  name.textContent = "Bagou";

  game.settings.get = (_namespace, key) => key === "showOriginalName";
  game.packs = new foundry.utils.Collection([[
    "dnd5e.spells",
    {
      index: [
        {
          _id: "spell-1",
          name: "Bagou",
          originalName: "Friends",
        },
      ],
    },
  ]]);

  appendOriginalNamesToDocumentMatches(root);

  assert.equal(name.querySelector(".babele-original-name")?.textContent, "Friends");
});
