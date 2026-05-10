import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {Babele} = await import("../module/script/core/babele.js");

test("Babele builds a headless translation session from framework registrations", async () => {
  const babele = Babele.create()
    .registerModule({
      module: "module-one",
      dir: "translations/fr",
      lang: "fr",
    });

  game.settings.get = (_namespace, key) => {
    if (key === "directory") {
      return "";
    }
    if (key === "language") {
      return "en";
    }
    return "";
  };
  game.data.packs = [{
    type: "Item",
    packageName: "module-one",
    packageType: "module",
    name: "items",
  }];

  foundry.applications.apps.FilePicker.browse = async (_source, dir) => {
    if (dir === "modules/module-one/translations/fr") {
      return {files: ["modules/module-one/translations/fr/module-one.items.json"]};
    }
    return {files: []};
  };
  globalThis.fetch = async () => ({
    async json() {
      return {
        entries: {
          sword: {
            name: "Epee",
          },
        },
      };
    },
  });

  const session = await babele.session("fr");

  assert.equal(session.language, "fr");
  assert.equal(session.isTranslated("module-one.items"), true);
  assert.deepEqual(session.translate("module-one.items", {
    _id: "sword",
    name: "Sword",
  }), {
    _id: "sword",
    name: "Epee",
    originalName: "Sword",
    translated: true,
    hasTranslation: true,
    flags: {
      babele: {
        originalName: "Sword",
        hasTranslation: true,
        translated: true,
        lang: "fr",
        originalPayload: {
          name: "Sword",
        },
      },
    },
  });
});

test("Babele.rollbackDocument restores original payload values and strips Babele markers", () => {
  const babele = Babele.create();

  const restored = babele.rollbackDocument("TestItem", {
    _id: "sword",
    name: "Epee",
    originalName: "Sword",
    translated: true,
    hasTranslation: true,
    flags: {
      someModule: {
        keep: true,
      },
      babele: {
        originalName: "Sword",
        hasTranslation: true,
        translated: true,
        originalPayload: {
          name: "Sword",
        },
      },
    },
  }, {
    customMapping: {
      name: "name",
    },
  });

  assert.deepEqual(restored, {
    _id: "sword",
    name: "Sword",
    flags: {
      someModule: {
        keep: true,
      },
    },
  });
});
