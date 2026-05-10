import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {DocumentTranslation} = await import("../module/script/translation/document-translation.js");

test("DocumentTranslation applies payloads and records Babele flags", () => {
  const source = {
    name: "Sword",
    system: {
      description: {
        value: "Original",
      },
    },
  };

  const translated = new DocumentTranslation({
    source,
    payload: {
      name: "Spada",
      system: {
        description: {
          value: "Tradotta",
        },
      },
    },
    hasTranslation: true,
    originalPayload: {
      name: "Sword",
      description: "Original",
    },
    language: "it",
  }).apply();

  assert.equal(translated.name, "Spada");
  assert.equal(translated.system.description.value, "Tradotta");
  assert.equal(translated.translated, true);
  assert.equal(translated.hasTranslation, true);
  assert.equal(translated.originalName, "Sword");
  assert.deepEqual(translated.flags.babele, {
    translated: true,
    hasTranslation: true,
    originalName: "Sword",
    lang: "it",
    originalPayload: {
      name: "Sword",
      description: "Original",
    },
  });
});

test("DocumentTranslation records no-op explicit translations on root documents", () => {
  const source = {
    name: "Sword",
  };

  const translated = new DocumentTranslation({
    source,
    payload: {},
    hasTranslation: true,
  }).apply();

  assert.notEqual(translated, source);
  assert.equal(translated.translated, false);
  assert.equal(translated.hasTranslation, true);
  assert.deepEqual(translated.flags.babele, {
    translated: false,
    hasTranslation: true,
    originalName: "Sword",
  });
});

test("DocumentTranslation can require payloads for embedded document materialization", () => {
  const source = {
    name: "Embedded Sword",
  };

  const translated = new DocumentTranslation({
    source,
    payload: {},
    hasTranslation: true,
    requiresPayload: true,
  }).apply();

  assert.equal(translated, source);
});

test("DocumentTranslation leaves documents unchanged without translation or changes", () => {
  const source = {
    name: "Sword",
  };

  const translated = new DocumentTranslation({
    source,
    payload: {},
    hasTranslation: false,
  }).apply();

  assert.equal(translated, source);
});
