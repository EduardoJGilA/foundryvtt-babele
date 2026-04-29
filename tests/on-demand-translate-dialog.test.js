import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";
import {FakeElement} from "./helpers/fake-dom.js";

installFoundryStubs();

const {OnDemandTranslateDialog} = await import("../module/script/ui/on-demand-translate-dialog.js");

function actorFixture(onUpdate = async () => {}) {
  return {
    name: "Goblin Warrior",
    items: {
      contents: [
        {
          id: "item-1",
          toObject() {
            return {_id: "item-1", name: "Sword", type: "weapon"};
          },
        },
        {
          id: "item-2",
          toObject() {
            return {_id: "item-2", name: "Shield", type: "armor"};
          },
        },
        {
          id: "item-3",
          toObject() {
            return {_id: "item-3", name: "Torch", type: "equipment"};
          },
        },
      ],
    },
    async updateEmbeddedDocuments(documentType, embeddedUpdates) {
      await onUpdate(documentType, embeddedUpdates);
    },
  };
}

function translatedPack() {
  return {
    translated: true,
    metadata: {
      type: "Item",
      label: "Translated Items",
    },
    hasTranslation(data, documentType) {
      return documentType === "Item" && (data._id === "item-1" || data._id === "item-2");
    },
    translate(data) {
      return {
        ...data,
        name: data._id === "item-1" ? "Spada" : "Scudo",
      };
    },
  };
}

test("OnDemandTranslateDialog renders as an ApplicationV2 review surface", async () => {
  const dialog = new OnDemandTranslateDialog(actorFixture());
  const rendered = dialog.render(false);

  assert.equal(rendered instanceof foundry.applications.api.ApplicationV2, true);
  assert.equal(rendered.renderOptions.force, false);
  assert.equal(OnDemandTranslateDialog.DEFAULT_OPTIONS.window.title, "BABELE.TranslateActorTitle");
  assert.equal(OnDemandTranslateDialog.DEFAULT_OPTIONS.position.width, 760);
});

test("OnDemandTranslateDialog prepares translated and untranslated review entries", async () => {
  game.babele.mappedCompendiums = new foundry.utils.Collection([
    ["test.items", translatedPack()],
  ]);

  const dialog = new OnDemandTranslateDialog(actorFixture());
  const context = await dialog._prepareContext({});

  assert.equal(context.actorName, "Goblin Warrior");
  assert.deepEqual(context.summary, {
    total: 3,
    ready: 2,
    modified: 0,
    translated: 0,
    untranslated: 1,
  });
  assert.equal(context.selectedCount, 2);
  assert.deepEqual(context.entries.map((entry) => ({
    id: entry.id,
    originalName: entry.originalName,
    proposedName: entry.proposedName,
    itemType: entry.itemType,
    packLabel: entry.packLabel,
      translated: entry.translated,
      filter: entry.filter,
      applicable: entry.applicable,
      selected: entry.selected,
  })), [
    {
      id: "item-1",
      originalName: "Sword",
      proposedName: "Spada",
      itemType: "weapon",
      packLabel: "Translated Items",
      translated: true,
      filter: "ready",
      applicable: true,
      selected: true,
    },
    {
      id: "item-2",
      originalName: "Shield",
      proposedName: "Scudo",
      itemType: "armor",
      packLabel: "Translated Items",
      translated: true,
      filter: "ready",
      applicable: true,
      selected: true,
    },
    {
      id: "item-3",
      originalName: "Torch",
      proposedName: "Missing",
      itemType: "equipment",
      packLabel: "",
      translated: false,
      filter: "missing",
      applicable: false,
      selected: false,
    },
  ]);
  assert.deepEqual(context.filters.map((filter) => ({
    filter: filter.filter,
    count: filter.count,
    active: filter.active,
  })), [
    {filter: "all", count: 3, active: true},
    {filter: "ready", count: 2, active: false},
    {filter: "modified", count: 0, active: false},
    {filter: "translated", count: 0, active: false},
    {filter: "missing", count: 1, active: false},
  ]);
});

test("OnDemandTranslateDialog marks already translated entries without selecting them", async () => {
  game.babele.mappedCompendiums = new foundry.utils.Collection([
    ["test.items", {
      translated: true,
      metadata: {
        type: "Item",
        label: "Translated Items",
      },
      hasTranslation(data, documentType) {
        return documentType === "Item" && data.name === "Sword";
      },
      translate(data) {
        return {...data, name: "Spada"};
      },
    }],
  ]);

  const dialog = new OnDemandTranslateDialog({
    name: "Goblin Warrior",
    items: {
      contents: [{
        id: "item-1",
        toObject() {
          return {
            _id: "item-1",
            name: "Spada",
            type: "weapon",
            flags: {
              babele: {
                hasTranslation: true,
                translated: true,
                originalName: "Sword",
              },
            },
          };
        },
      }],
    },
  });
  const context = await dialog._prepareContext({});

  assert.equal(context.selectedCount, 0);
  assert.deepEqual(context.summary, {
    total: 1,
    ready: 0,
    modified: 0,
    translated: 1,
    untranslated: 0,
  });
  assert.deepEqual(context.entries.map((entry) => ({
    originalName: entry.originalName,
    currentName: entry.currentName,
    hasCurrentTranslation: entry.hasCurrentTranslation,
    proposedName: entry.proposedName,
    proposedMissing: entry.proposedMissing,
    alreadyTranslated: entry.alreadyTranslated,
    applicable: entry.applicable,
    selected: entry.selected,
    cssClass: entry.cssClass,
    status: entry.status,
    candidateChoiceEnabled: entry.candidateChoiceEnabled,
  })), [{
    originalName: "Sword",
    currentName: "Spada",
    hasCurrentTranslation: true,
    proposedName: "Spada",
    proposedMissing: false,
    alreadyTranslated: true,
    applicable: false,
    selected: false,
    cssClass: "is-already",
    status: "Translated",
    candidateChoiceEnabled: false,
  }]);
});

test("OnDemandTranslateDialog shows already translated inline items without a proposed duplicate", async () => {
  game.babele.mappedCompendiums = new foundry.utils.Collection();

  const dialog = new OnDemandTranslateDialog({
    name: "Goblin Warrior",
    items: {
      contents: [{
        id: "item-1",
        toObject() {
          return {
            _id: "item-1",
            name: "Spada",
            type: "weapon",
            flags: {
              babele: {
                hasTranslation: true,
                translated: true,
                originalName: "Sword",
              },
            },
          };
        },
      }],
    },
  });
  const context = await dialog._prepareContext({});

  assert.equal(context.selectedCount, 0);
  assert.deepEqual(context.summary, {
    total: 1,
    ready: 0,
    modified: 0,
    translated: 1,
    untranslated: 0,
  });
  assert.deepEqual(context.entries.map((entry) => ({
    originalName: entry.originalName,
    currentName: entry.currentName,
    hasCurrentTranslation: entry.hasCurrentTranslation,
    proposedName: entry.proposedName,
    proposedMissing: entry.proposedMissing,
    hasCandidates: entry.hasCandidates,
    candidateChoiceEnabled: entry.candidateChoiceEnabled,
    filter: entry.filter,
    status: entry.status,
  })), [{
    originalName: "Sword",
    currentName: "Spada",
    hasCurrentTranslation: true,
    proposedName: "Missing",
    proposedMissing: true,
    hasCandidates: false,
    candidateChoiceEnabled: false,
    filter: "translated",
    status: "Translated",
  }]);
});

test("OnDemandTranslateDialog marks user-changed imported items as modified", async () => {
  const previousSourceDataForUuid = game.babele.sourceDataForUuid;

  try {
    game.babele.sourceDataForUuid = async () => ({
      _id: "weapon-focus",
      name: "Weapon Focus",
      type: "feat",
      system: {
        description: {value: "Original description"},
      },
    });
    game.babele.mappedCompendiums = new foundry.utils.Collection([
      ["test.feats", {
        translated: true,
        metadata: {
          type: "Item",
          label: "Translated Feats",
        },
        hasTranslation(data, documentType) {
          return documentType === "Item" && data.flags?.core?.sourceId === "Compendium.test.feats.Item.weapon-focus";
        },
        translate() {
          return {
            name: "Arma Focalizzata",
            system: {
              description: {value: "Descrizione tradotta"},
            },
          };
        },
        extract(data) {
          return {
            name: data.name,
            description: data.system?.description?.value,
          };
        },
      }],
    ]);

    const dialog = new OnDemandTranslateDialog(actorWithOneItem({
      _id: "embedded-feat",
      name: "Weapon Focus (Longsword)",
      type: "feat",
      system: {
        description: {value: "Original description"},
      },
      flags: {
        core: {
          sourceId: "Compendium.test.feats.Item.weapon-focus",
        },
      },
    }));
    const context = await dialog._prepareContext({});

    assert.equal(context.selectedCount, 0);
    assert.deepEqual(context.summary, {
      total: 1,
      ready: 0,
      modified: 1,
      translated: 0,
      untranslated: 0,
    });
    assert.deepEqual(context.entries.map((entry) => ({
      originalName: entry.originalName,
      proposedName: entry.proposedName,
      userChanged: entry.userChanged,
      applicable: entry.applicable,
      selected: entry.selected,
      cssClass: entry.cssClass,
      status: entry.status,
      candidateChoiceEnabled: entry.candidateChoiceEnabled,
    })), [{
      originalName: "Weapon Focus (Longsword)",
      proposedName: "Arma Focalizzata",
      userChanged: true,
      applicable: true,
      selected: false,
      cssClass: "is-modified",
      status: "Modified",
      candidateChoiceEnabled: false,
    }]);
  } finally {
    game.babele.sourceDataForUuid = previousSourceDataForUuid;
  }
});

test("OnDemandTranslateDialog marks no-op translations as unchanged", async () => {
  game.babele.mappedCompendiums = new foundry.utils.Collection([
    ["test.items", {
      translated: true,
      metadata: {
        type: "Item",
        label: "Translated Items",
      },
      hasTranslation(data, documentType) {
        return documentType === "Item" && data._id === "item-1";
      },
      translate(data) {
        return {name: data.name};
      },
    }],
  ]);

  const dialog = new OnDemandTranslateDialog({
    name: "Goblin Warrior",
    items: {
      contents: [{
        id: "item-1",
        toObject() {
          return {_id: "item-1", name: "Rations", type: "consumable"};
        },
      }],
    },
  });
  const context = await dialog._prepareContext({});

  assert.equal(context.selectedCount, 0);
  assert.deepEqual(context.summary, {
    total: 1,
    ready: 0,
    modified: 0,
    translated: 1,
    untranslated: 0,
  });
  assert.deepEqual(context.entries.map((entry) => ({
    originalName: entry.originalName,
    proposedName: entry.proposedName,
    unchanged: entry.unchanged,
    applicable: entry.applicable,
    selected: entry.selected,
    cssClass: entry.cssClass,
    status: entry.status,
  })), [{
    originalName: "Rations",
    proposedName: "Rations",
    unchanged: true,
    applicable: false,
    selected: false,
    cssClass: "is-unchanged",
    status: "No changes",
  }]);
});

test("OnDemandTranslateDialog exposes multiple translation candidates", async () => {
  game.babele.mappedCompendiums = new foundry.utils.Collection([
    ["dnd5e.items", translatedCandidatePack("dnd5e.items", "2014 Items", "Coup à mains nues")],
    ["dnd5e.actions", translatedCandidatePack("dnd5e.actions", "2024 Actions", "Frappe à mains nues")],
  ]);

  const dialog = new OnDemandTranslateDialog(actorWithOneItem({
    _id: "item-1",
    name: "Unarmed Strike",
    type: "weapon",
  }));
  const context = await dialog._prepareContext({});

  assert.deepEqual(context.entries.map((entry) => ({
    proposedName: entry.proposedName,
    packLabel: entry.packLabel,
    hasCandidateChoices: entry.hasCandidateChoices,
    candidates: entry.candidates,
  })), [{
    proposedName: "Coup à mains nues",
    packLabel: "2014 Items",
    hasCandidateChoices: true,
    candidates: [
      {
        id: "dnd5e.items::0",
        label: "2014 Items",
        proposedName: "Coup à mains nues",
        selected: true,
      },
      {
        id: "dnd5e.actions::1",
        label: "2024 Actions",
        proposedName: "Frappe à mains nues",
        selected: false,
      },
    ],
  }]);
});

test("OnDemandTranslateDialog exposes a disabled selector for a single candidate", async () => {
  game.babele.mappedCompendiums = new foundry.utils.Collection([
    ["dnd5e.items", translatedCandidatePack("dnd5e.items", "2014 Items", "Coup à mains nues")],
  ]);

  const dialog = new OnDemandTranslateDialog(actorWithOneItem({
    _id: "item-1",
    name: "Unarmed Strike",
    type: "weapon",
  }));
  const context = await dialog._prepareContext({});

  assert.deepEqual(context.entries.map((entry) => ({
    hasCandidates: entry.hasCandidates,
    hasCandidateChoices: entry.hasCandidateChoices,
    candidates: entry.candidates,
  })), [{
    hasCandidates: true,
    hasCandidateChoices: false,
    candidates: [{
      id: "dnd5e.items::0",
      label: "2014 Items",
      proposedName: "Coup à mains nues",
      selected: true,
    }],
  }]);
});

test("OnDemandTranslateDialog applies the selected translation candidate", async () => {
  let updates = null;
  game.babele.mappedCompendiums = new foundry.utils.Collection([
    ["dnd5e.items", translatedCandidatePack("dnd5e.items", "2014 Items", "Coup à mains nues")],
    ["dnd5e.actions", translatedCandidatePack("dnd5e.actions", "2024 Actions", "Frappe à mains nues")],
  ]);
  const dialog = new OnDemandTranslateDialog(actorWithOneItem({
    _id: "item-1",
    name: "Unarmed Strike",
    type: "weapon",
  }, async (documentType, embeddedUpdates) => {
    updates = {documentType, embeddedUpdates};
  }));
  const root = actorTranslationRoot(["item-1"], {"item-1": "ready"}, {
    "item-1": "dnd5e.actions::1",
  });

  await dialog._prepareContext({});
  dialog.element = root;
  await dialog._onRender({}, {});

  root.listeners.get("change")({
    target: candidateSelectorFor(root, "item-1"),
  });

  await root.listeners.get("click")({
    target: actionButton(root, "apply-selected"),
    preventDefault() {},
  });

  assert.deepEqual(updates, {
    documentType: "Item",
    embeddedUpdates: [{
      _id: "item-1",
      name: "Frappe à mains nues",
      type: "weapon",
      originalName: "Unarmed Strike",
      hasTranslation: true,
      translated: true,
      flags: {
        babele: {
          originalName: "Unarmed Strike",
          hasTranslation: true,
          translated: true,
        },
      },
    }],
  });
});

test("OnDemandTranslateDialog preserves list scroll when a candidate changes", async () => {
  game.babele.mappedCompendiums = new foundry.utils.Collection([
    ["dnd5e.items", translatedCandidatePack("dnd5e.items", "2014 Items", "Coup à mains nues")],
    ["dnd5e.actions", translatedCandidatePack("dnd5e.actions", "2024 Actions", "Frappe à mains nues")],
  ]);
  const dialog = new OnDemandTranslateDialog(actorWithOneItem({
    _id: "item-1",
    name: "Unarmed Strike",
    type: "weapon",
  }));
  const root = actorTranslationRoot(["item-1"], {"item-1": "ready"}, {
    "item-1": "dnd5e.actions::1",
  });

  await dialog._prepareContext({});
  dialog.element = root;
  await dialog._onRender({}, {});
  root.querySelector(".babele-actor-translation__list").scrollTop = 231;
  dialog.render = () => {
    throw new Error("candidate changes must not rerender the dialog");
  };

  root.listeners.get("change")({
    target: candidateSelectorFor(root, "item-1"),
  });

  assert.equal(root.querySelector(".babele-actor-translation__list").scrollTop, 231);
  assert.equal(entryFor(root, "item-1").querySelector("[data-proposed-name]").textContent, "Frappe à mains nues");
});

test("OnDemandTranslateDialog applies only selected translated entries", async () => {
  let updates = null;
  game.babele.mappedCompendiums = new foundry.utils.Collection([
    ["test.items", translatedPack()],
  ]);
  const dialog = new OnDemandTranslateDialog(actorFixture(async (documentType, embeddedUpdates) => {
    updates = {documentType, embeddedUpdates};
  }));
  const root = actorTranslationRoot(["item-1", "item-2"]);

  await dialog._prepareContext({});
  dialog.element = root;
  await dialog._onRender({}, {});

  const firstSelector = selectorFor(root, "item-1");
  firstSelector.checked = false;
  root.listeners.get("change")({
    target: firstSelector,
  });

  await root.listeners.get("click")({
    target: actionButton(root, "apply-selected"),
    preventDefault() {},
  });

  assert.deepEqual(updates, {
    documentType: "Item",
    embeddedUpdates: [
      {
        _id: "item-2",
        name: "Scudo",
        type: "armor",
        originalName: "Shield",
        hasTranslation: true,
        translated: true,
        flags: {
          babele: {
            originalName: "Shield",
            hasTranslation: true,
            translated: true,
          },
        },
      },
    ],
  });
});

test("OnDemandTranslateDialog selection toolbar updates selected count and apply state", async () => {
  game.babele.mappedCompendiums = new foundry.utils.Collection([
    ["test.items", translatedPack()],
  ]);
  const dialog = new OnDemandTranslateDialog(actorFixture());
  const root = actorTranslationRoot(["item-1", "item-2"]);

  await dialog._prepareContext({});
  dialog.element = root;
  await dialog._onRender({}, {});

  await root.listeners.get("click")({
    target: actionButton(root, "select-none"),
    preventDefault() {},
  });

  assert.equal(selectorFor(root, "item-1").checked, false);
  assert.equal(selectorFor(root, "item-2").checked, false);
  assert.equal(actionButton(root, "apply-selected").disabled, true);
  assert.equal(root.querySelector("[data-selected-count]").textContent, "0");

  await root.listeners.get("click")({
    target: actionButton(root, "select-all"),
    preventDefault() {},
  });

  assert.equal(selectorFor(root, "item-1").checked, true);
  assert.equal(selectorFor(root, "item-2").checked, true);
  assert.equal(actionButton(root, "apply-selected").disabled, false);
  assert.equal(root.querySelector("[data-selected-count]").textContent, "2");
});

test("OnDemandTranslateDialog filters entries by review state", async () => {
  game.babele.mappedCompendiums = new foundry.utils.Collection([
    ["test.items", translatedPack()],
  ]);
  const dialog = new OnDemandTranslateDialog(actorFixture());
  const root = actorTranslationRoot(["item-1", "item-2", "item-3", "item-4"], {
    "item-1": "ready",
    "item-2": "translated",
    "item-3": "missing",
    "item-4": "modified",
  });

  await dialog._prepareContext({});
  dialog.element = root;
  await dialog._onRender({}, {});

  await root.listeners.get("click")({
    target: filterButton(root, "missing"),
    preventDefault() {},
  });

  assert.equal(entryFor(root, "item-1").hidden, true);
  assert.equal(entryFor(root, "item-2").hidden, true);
  assert.equal(entryFor(root, "item-3").hidden, false);
  assert.equal(entryFor(root, "item-4").hidden, true);
  assert.equal(filterButton(root, "missing").getAttribute("aria-pressed"), "true");

  await root.listeners.get("click")({
    target: filterButton(root, "modified"),
    preventDefault() {},
  });

  assert.equal(entryFor(root, "item-1").hidden, true);
  assert.equal(entryFor(root, "item-2").hidden, true);
  assert.equal(entryFor(root, "item-3").hidden, false);
  assert.equal(entryFor(root, "item-4").hidden, false);
  assert.equal(filterButton(root, "missing").getAttribute("aria-pressed"), "true");
  assert.equal(filterButton(root, "modified").getAttribute("aria-pressed"), "true");

  await root.listeners.get("click")({
    target: filterButton(root, "all"),
    preventDefault() {},
  });

  assert.equal(entryFor(root, "item-1").hidden, false);
  assert.equal(entryFor(root, "item-2").hidden, false);
  assert.equal(entryFor(root, "item-3").hidden, false);
  assert.equal(entryFor(root, "item-4").hidden, false);
  assert.equal(filterButton(root, "all").getAttribute("aria-pressed"), "true");
});

function actorTranslationRoot(entryIds, filtersById = {}, candidateIdsByEntryId = {}) {
  const root = new FakeElement("section");

  const selectedCount = new FakeElement("strong");
  selectedCount.dataset.selectedCount = "";
  selectedCount.setAttribute("data-selected-count", "");
  root.appendChild(selectedCount);

  for (const action of ["select-all", "select-none", "apply-selected", "cancel"]) {
    const button = new FakeElement("button");
    button.dataset.action = action;
    button.setAttribute("data-action", action);
    root.appendChild(button);
  }

  for (const filter of ["all", "ready", "modified", "translated", "missing"]) {
    const button = new FakeElement("button");
    button.dataset.action = "filter";
    button.dataset.filter = filter;
    button.setAttribute("data-action", "filter");
    button.setAttribute("data-filter", filter);
    root.appendChild(button);
  }

  for (const summary of ["total", "ready", "modified", "translated", "untranslated"]) {
    const count = new FakeElement("strong");
    count.dataset[`summary${summary[0].toUpperCase()}${summary.slice(1)}`] = "";
    count.setAttribute(`data-summary-${summary}`, "");
    root.appendChild(count);
  }

  const list = new FakeElement("ol");
  list.className = "babele-actor-translation__list";
  root.appendChild(list);

  for (const entryId of entryIds) {
    const entry = new FakeElement("li");
    entry.dataset.entryId = entryId;
    entry.dataset.entryFilter = filtersById[entryId] ?? "ready";
    entry.setAttribute("data-entry-id", entryId);
    entry.setAttribute("data-entry-filter", entry.dataset.entryFilter);

    const selector = new FakeElement("input");
    selector.dataset.entrySelector = "";
    selector.dataset.entryId = entryId;
    selector.setAttribute("data-entry-selector", "");
    selector.checked = true;
    entry.appendChild(selector);

    const proposedName = new FakeElement("strong");
    proposedName.dataset.proposedName = "";
    proposedName.setAttribute("data-proposed-name", "");
    entry.appendChild(proposedName);

    const status = new FakeElement("span");
    status.dataset.entryStatus = "";
    status.setAttribute("data-entry-status", "");
    entry.appendChild(status);

    if (candidateIdsByEntryId[entryId]) {
      const candidateSelector = new FakeElement("select");
      candidateSelector.dataset.candidateSelector = "";
      candidateSelector.dataset.entryId = entryId;
      candidateSelector.value = candidateIdsByEntryId[entryId];
      candidateSelector.setAttribute("data-candidate-selector", "");
      entry.appendChild(candidateSelector);
    }

    list.appendChild(entry);
  }

  return root;
}

function selectorFor(root, entryId) {
  return root.querySelectorAll("[data-entry-selector]")
    .find((selector) => selector.dataset.entryId === entryId);
}

function actionButton(root, action) {
  return root.querySelector(`[data-action="${action}"]`);
}

function filterButton(root, filter) {
  return root.querySelector(`[data-filter="${filter}"]`);
}

function entryFor(root, entryId) {
  return root.querySelector(`[data-entry-id="${entryId}"]`);
}

function candidateSelectorFor(root, entryId) {
  return entryFor(root, entryId).querySelector("[data-candidate-selector]");
}

function actorWithOneItem(item, onUpdate = async () => {}) {
  return {
    name: "Goblin Warrior",
    items: {
      contents: [{
        id: item._id,
        toObject() {
          return {...item};
        },
      }],
    },
    async updateEmbeddedDocuments(documentType, embeddedUpdates) {
      await onUpdate(documentType, embeddedUpdates);
    },
  };
}

function translatedCandidatePack(collection, label, translatedName) {
  return {
    translated: true,
    metadata: {
      type: "Item",
      collection,
      label,
    },
    hasTranslation(data, documentType) {
      return documentType === "Item" && data.name === "Unarmed Strike";
    },
    translate(data) {
      return {...data, name: translatedName};
    },
  };
}
