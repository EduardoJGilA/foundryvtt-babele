import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {OnDemandTranslateDialog} = await import("../module/script/ui/on-demand-translate-dialog.js");

test("OnDemandTranslateDialog renders through DialogV2 with the expected translate action", () => {
  const actor = {
    items: {
      contents: [],
    },
  };

  const dialog = new OnDemandTranslateDialog(actor);
  const rendered = dialog.render(false);

  assert.equal(rendered instanceof foundry.applications.api.DialogV2, true);
  assert.equal(rendered.config.window.title, "BABELE.TranslateActorTitle");
  assert.equal(rendered.config.position.width, 600);
  assert.equal(rendered.config.form.closeOnSubmit, false);
  assert.equal(rendered.config.buttons.length, 1);
  assert.equal(rendered.config.buttons[0].action, "translate");
  assert.equal(rendered.renderOptions.force, false);
});

test("OnDemandTranslateDialog translates matching actor items and updates embedded documents", async () => {
  let updates = null;
  const actor = {
    items: {
      contents: [
        {
          id: "item-1",
          toObject() {
            return {_id: "item-1", name: "Sword"};
          },
        },
        {
          id: "item-2",
          toObject() {
            return {_id: "item-2", name: "Shield"};
          },
        },
      ],
    },
    async updateEmbeddedDocuments(documentType, embeddedUpdates) {
      updates = {documentType, embeddedUpdates};
    },
  };

  const translatedPack = {
    translated: true,
    metadata: {
      type: "Item",
    },
    hasTranslation(data, documentType) {
      return documentType === "Item" && data._id === "item-1";
    },
    translate(data) {
      return {...data, name: "Spada"};
    },
  };

  game.babele.mappedCompendiums = new foundry.utils.Collection([
    ["test.items", translatedPack],
  ]);

  const dialog = new OnDemandTranslateDialog(actor);
  const rendered = dialog.render();
  const area = {
    textContent: "",
    scrollTop: 0,
    scrollHeight: 64,
  };

  await rendered.config.buttons[0].callback(null, {
    form: {
      elements: {
        "actor-translate-log": area,
      },
    },
  });

  assert.deepEqual(updates, {
    documentType: "Item",
    embeddedUpdates: [
      {_id: "item-1", name: "Spada"},
    ],
  });
  assert.match(area.textContent, /^start\.\.\./);
  assert.match(area.textContent, /Sword.+ok/);
  assert.match(area.textContent, /Shield.+not found/);
  assert.match(area.textContent, /Done\. tot items: 2, tot translated: 1, tot untranslated: 1/);
  assert.equal(area.scrollTop, 64);
});
