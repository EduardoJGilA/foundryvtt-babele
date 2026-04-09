import test from "node:test";
import assert from "node:assert/strict";
import {installFoundryStubs} from "./helpers/foundry-stubs.js";

installFoundryStubs();

const {FieldMapping} = await import("../module/script/field-mapping.js");

test("FieldMapping.map preserves empty string translations", () => {
  const mapping = new FieldMapping("description", "system.description.value", null);
  const data = {
    system: {
      description: {
        value: "Original description",
      },
    },
  };

  assert.deepEqual(mapping.map(data, {description: ""}), {
    system: {
      description: {
        value: "",
      },
    },
  });
});

test("FieldMapping.map preserves zero and false translations", () => {
  const zeroMapping = new FieldMapping("weight", "system.weight", null);
  const falseMapping = new FieldMapping("identified", "system.identified", null);
  const data = {
    system: {
      weight: 12,
      identified: true,
    },
  };

  assert.deepEqual(zeroMapping.map(data, {weight: 0}), {
    system: {
      weight: 0,
    },
  });
  assert.deepEqual(falseMapping.map(data, {identified: false}), {
    system: {
      identified: false,
    },
  });
});

test("FieldMapping.map still skips undefined and null translations", () => {
  const mapping = new FieldMapping("description", "system.description.value", null);
  const data = {
    system: {
      description: {
        value: "Original description",
      },
    },
  };

  assert.deepEqual(mapping.map(data, {description: undefined}), {});
  assert.deepEqual(mapping.map(data, {description: null}), {});
});
