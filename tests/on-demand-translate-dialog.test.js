import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {OnDemandTranslateDialog} = await import("../module/script/ui/on-demand-translate-dialog.js");

test("OnDemandTranslateDialog only selects translated packs for the requested document type", () => {
  const actorPack = {
    translated: true,
    metadata: {
      type: "Actor",
    },
    hasTranslation(data, documentType) {
      return documentType === this.metadata.type && data._id === "shared-id";
    },
  };

  const itemPack = {
    translated: true,
    metadata: {
      type: "Item",
    },
    hasTranslation(data, documentType) {
      return documentType === this.metadata.type && data._id === "shared-id";
    },
  };

  const pack = OnDemandTranslateDialog.translatedPackFor(
    "Item",
    {
      _id: "shared-id",
      name: "Shared Name",
    },
    [actorPack, itemPack],
  );

  assert.equal(pack, itemPack);
});
