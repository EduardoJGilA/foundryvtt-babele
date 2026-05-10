import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";
import {FakeElement} from "./helpers/fake-dom.js";

installFoundryStubs();

const {SourcePriorityDialog, SourcePrioritySettings} = await import("../module/script/ui/source-priority-settings.js");

function priorityForm({enabled = true, rows = []} = {}) {
  const collectionElement = {
    dataset: {collection: "test.items"},
    querySelector(selector) {
      if (selector === '[name="sourcePriorityEnabled"]') {
        return {checked: enabled};
      }

      return null;
    },
    querySelectorAll(selector) {
      if (selector !== ".babele-source-priority-row") {
        return [];
      }

      return rows.map((row) => ({
        dataset: {source: row.source},
      }));
    },
  };

  return {
    querySelectorAll(selector) {
      return selector === ".babele-source-priority-collection" ? [collectionElement] : [];
    },
  };
}

test("SourcePriorityDialog persists reordered sources and refreshes once", async () => {
  const saved = [];
  let refreshCalls = 0;
  let renderedTemplate = null;

  game.babele.sourceDiagnostics = async () => ({
    translation: {
      overlaps: [{
        collection: "test.items",
        sourceCount: 2,
        sources: ["module:one:it", "module:two:it"],
      }],
    },
  });
  game.babele.sourcePriority = () => ({global: [], collections: {}});
  game.babele.setSourcePriority = async (collection, sources, options) => {
    saved.push({collection, sources, options});
  };
  game.babele.refreshTranslationSources = async () => {
    refreshCalls += 1;
  };
  foundry.applications.handlebars.renderTemplate = async (path, context) => {
    renderedTemplate = {path, context};
    return "<form></form>";
  };
  foundry.applications.api.DialogV2.input = async (config) => config.ok.callback(null, {
    form: priorityForm({
      rows: [
        {source: "module:two:it"},
        {source: "module:one:it"},
      ],
    }),
  });

  const updates = await new SourcePriorityDialog().prompt();

  assert.equal(renderedTemplate.path, "modules/babele/templates/source-priority-settings.html");
  assert.equal(renderedTemplate.context.hasOverlaps, true);
  assert.deepEqual(saved, [{
    collection: "test.items",
    sources: ["module:two:it", "module:one:it"],
    options: {refresh: false},
  }]);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(updates, [{
    collection: "test.items",
    sources: ["module:two:it", "module:one:it"],
  }]);
});

test("SourcePriorityDialog clears priority when a collection is disabled", async () => {
  const saved = [];

  game.babele.sourceDiagnostics = async () => ({
    translation: {
      overlaps: [{
        collection: "test.items",
        sourceCount: 2,
        sources: ["module:one:it", "module:two:it"],
      }],
    },
  });
  game.babele.sourcePriority = () => ({
    global: [],
    collections: {
      "test.items": ["module:one:it", "module:two:it"],
    },
  });
  game.babele.setSourcePriority = async (collection, sources) => {
    saved.push({collection, sources});
  };
  game.babele.refreshTranslationSources = async () => {};
  foundry.applications.handlebars.renderTemplate = async () => "<form></form>";
  foundry.applications.api.DialogV2.input = async (config) => config.ok.callback(null, {
    form: priorityForm({
      enabled: false,
      rows: [
        {source: "module:one:it"},
        {source: "module:two:it"},
      ],
    }),
  });

  await new SourcePriorityDialog().prompt();

  assert.deepEqual(saved, [{
    collection: "test.items",
    sources: [],
  }]);
});

test("SourcePriorityDialog moves rows with reorder buttons before saving", async () => {
  const saved = [];
  const root = sourcePriorityRoot(["module:one:it", "module:two:it", "module:three:it"], {enabled: true});

  game.babele.sourceDiagnostics = async () => ({
    translation: {
      overlaps: [{
        collection: "test.items",
        sourceCount: 3,
        sources: ["module:one:it", "module:two:it", "module:three:it"],
      }],
    },
  });
  game.babele.sourcePriority = () => ({global: [], collections: {}});
  game.babele.setSourcePriority = async (collection, sources) => {
    saved.push({collection, sources});
  };
  game.babele.refreshTranslationSources = async () => {};
  foundry.applications.handlebars.renderTemplate = async () => "<form></form>";
  foundry.applications.api.DialogV2.input = async (config) => {
    config.render(null, {element: root});

    const secondDown = root
      .querySelectorAll(".babele-source-priority-row")[1]
      .querySelectorAll("[data-action]")
      .find((button) => button.dataset.action === "source-priority-down");

    root.listeners.get("click")({
      target: secondDown,
      preventDefault() {},
    });

    return config.ok.callback(null, {form: root});
  };

  await new SourcePriorityDialog().prompt();

  assert.equal(root.querySelector('[name="sourcePriorityEnabled"]').checked, true);
  assert.deepEqual(saved, [{
    collection: "test.items",
    sources: ["module:one:it", "module:three:it", "module:two:it"],
  }]);
});

test("SourcePriorityDialog refreshes disabled state for boundary reorder buttons", async () => {
  const root = sourcePriorityRoot(["module:one:it", "module:two:it", "module:three:it"], {enabled: true});

  game.babele.sourceDiagnostics = async () => ({translation: {overlaps: []}});
  game.babele.sourcePriority = () => ({global: [], collections: {}});
  foundry.applications.handlebars.renderTemplate = async () => "<form></form>";
  foundry.applications.api.DialogV2.input = async (config) => {
    config.render(null, {element: root});

    assert.equal(buttonFor(root.querySelectorAll(".babele-source-priority-row")[0], "source-priority-up").disabled, true);
    assert.equal(buttonFor(root.querySelectorAll(".babele-source-priority-row")[2], "source-priority-down").disabled, true);

    clickAction(root, root.querySelectorAll(".babele-source-priority-row")[1], "source-priority-up");

    assert.equal(root.querySelectorAll(".babele-source-priority-row")[0].dataset.source, "module:two:it");
    assert.equal(root.querySelectorAll(".babele-source-priority-row")[0].dataset.priority, "1");
    assert.equal(buttonFor(root.querySelectorAll(".babele-source-priority-row")[0], "source-priority-up").disabled, true);
    assert.equal(buttonFor(root.querySelectorAll(".babele-source-priority-row")[1], "source-priority-up").disabled, false);

    return [];
  };

  await new SourcePriorityDialog().prompt();
});

test("SourcePriorityDialog enables reorder controls only for selected collections", async () => {
  const root = sourcePriorityRoot(["module:one:it", "module:two:it", "module:three:it"], {enabled: false});

  game.babele.sourceDiagnostics = async () => ({translation: {overlaps: []}});
  game.babele.sourcePriority = () => ({global: [], collections: {}});
  foundry.applications.handlebars.renderTemplate = async () => "<form></form>";
  foundry.applications.api.DialogV2.input = async (config) => {
    config.render(null, {element: root});

    const firstOrder = rowSources(root);
    assert.equal(buttonFor(root.querySelectorAll(".babele-source-priority-row")[1], "source-priority-up").disabled, true);

    clickAction(root, root.querySelectorAll(".babele-source-priority-row")[1], "source-priority-up");
    assert.deepEqual(rowSources(root), firstOrder);

    const enabled = root.querySelector('[name="sourcePriorityEnabled"]');
    enabled.checked = true;
    root.listeners.get("change")({
      target: enabled,
    });

    assert.equal(buttonFor(root.querySelectorAll(".babele-source-priority-row")[1], "source-priority-up").disabled, false);
    clickAction(root, root.querySelectorAll(".babele-source-priority-row")[1], "source-priority-up");
    assert.deepEqual(rowSources(root), ["module:two:it", "module:one:it", "module:three:it"]);

    enabled.checked = false;
    root.listeners.get("change")({
      target: enabled,
    });
    assert.equal(buttonFor(root.querySelectorAll(".babele-source-priority-row")[1], "source-priority-up").disabled, true);

    return [];
  };

  await new SourcePriorityDialog().prompt();
});

test("SourcePrioritySettings opens the source priority dialog from the settings menu", () => {
  let opened = false;
  const originalPrompt = SourcePriorityDialog.prototype.prompt;
  SourcePriorityDialog.prototype.prompt = () => {
    opened = true;
  };

  try {
    const app = new SourcePrioritySettings();
    assert.equal(app.render(), app);
    assert.equal(opened, true);
  } finally {
    SourcePriorityDialog.prototype.prompt = originalPrompt;
  }
});

function sourcePriorityRoot(sources, {enabled = false} = {}) {
  const root = new FakeElement("form");
  const collection = new FakeElement("section");
  collection.className = "babele-source-priority-collection";
  collection.dataset.collection = "test.items";
  root.appendChild(collection);

  const enabledInput = new FakeElement("input");
  enabledInput.setAttribute("name", "sourcePriorityEnabled");
  enabledInput.checked = enabled;
  collection.appendChild(enabledInput);

  const table = new FakeElement("div");
  table.className = "babele-source-priority-table";
  collection.appendChild(table);

  for (const source of sources) {
    const row = new FakeElement("div");
    row.className = "babele-source-priority-row";
    row.dataset.source = source;
    table.appendChild(row);

    const controls = new FakeElement("div");
    controls.className = "babele-source-priority-controls";
    row.appendChild(controls);

    const up = new FakeElement("button");
    up.dataset.action = "source-priority-up";
    controls.appendChild(up);

    const down = new FakeElement("button");
    down.dataset.action = "source-priority-down";
    controls.appendChild(down);
  }

  return root;
}

function buttonFor(row, action) {
  return row
    .querySelectorAll("[data-action]")
    .find((button) => button.dataset.action === action);
}

function clickAction(root, row, action) {
  root.listeners.get("click")({
    target: buttonFor(row, action),
    preventDefault() {},
  });
}

function rowSources(root) {
  return root
    .querySelectorAll(".babele-source-priority-row")
    .map((row) => row.dataset.source);
}
