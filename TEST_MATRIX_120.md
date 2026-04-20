# Test Matrix for Issue #120

This matrix is focused on the `#120` fix:

- Adventure packs with multiple Adventure entries
- embedded-document translation context inside Adventure entries
- preservation of normal `fromPack` behavior outside Adventure packs

## Scope

Files touched by the fix:

- [module/script/babele.js](/Volumes/Envoy/2_Areas/Dev/Idea Projects/foundryvtt-babele/module/script/babele.js)
- [module/script/converters.js](/Volumes/Envoy/2_Areas/Dev/Idea Projects/foundryvtt-babele/module/script/converters.js)
- [module/script/translated-compendium.js](/Volumes/Envoy/2_Areas/Dev/Idea Projects/foundryvtt-babele/module/script/translated-compendium.js)

## Preconditions

- Babele enabled
- One language with working translation files
- At least one translated normal Item or Actor compendium available
- At least one translated Adventure pack available
- Preferably one Adventure pack with more than one Adventure entry in the same pack

## Test Cases

### T1. Non-Adventure `fromPack` regression check

Goal:

- Verify that `fromPack` still behaves exactly as before in normal compendiums.

Setup:

- Use a normal translated Actor pack with embedded Items translated through `fromPack`.

Steps:

1. Open a translated Actor compendium entry from a normal pack.
2. Check embedded Items that should be translated from a physical Item compendium.
3. Compare with current stable behavior.

Expected:

- Embedded Items are translated exactly as before.
- No missing names or descriptions.
- No console errors.

### T2. Single Adventure entry with local embedded Item translation

Goal:

- Verify that local Adventure entry translations still override fallback pack translations.

Setup:

- One Adventure entry with an embedded Item translated directly under its `items` section.

Steps:

1. Open the Adventure pack index.
2. Open the Adventure entry.
3. Inspect the embedded Item data after import or preview, depending on the workflow used.

Expected:

- The embedded Item uses the local translation from the Adventure entry.
- It does not incorrectly fall back to another translated compendium first.

### T3. Single Adventure entry with fallback to physical translated compendium

Goal:

- Verify that physical translated compendiums are still used when the Adventure entry has no local embedded translation.

Setup:

- One Adventure entry with an embedded Item or Actor that also exists in a translated physical compendium.
- No local embedded translation for that specific document inside the Adventure JSON.

Steps:

1. Open or import the Adventure entry.
2. Inspect the embedded document.

Expected:

- The embedded document is translated through the physical translated compendium.
- No regression compared to the old `fromPack` fallback behavior.

### T4. Multi-entry Adventure pack does not overwrite embedded Item context

Goal:

- Verify the bug reported in `#120` is fixed for Items.

Setup:

- One Adventure pack with at least two Adventure entries in the same translation file.
- Each Adventure entry has different embedded Item translations.

Steps:

1. Open or import the first Adventure entry and inspect its embedded Items.
2. Open or import the second Adventure entry and inspect its embedded Items.
3. Repeat the first entry again.

Expected:

- Each Adventure entry uses its own embedded Item translations.
- The second entry does not overwrite the first one.
- Reopening the first entry still shows the correct first-entry translations.

### T5. Multi-entry Adventure pack does not overwrite embedded Actor context

Goal:

- Verify the same fix works for Actors, not just Items.

Setup:

- One Adventure pack with at least two Adventure entries in the same translation file.
- Each Adventure entry has different embedded Actor translations.

Steps:

1. Open or import the first Adventure entry and inspect its embedded Actors.
2. Open or import the second Adventure entry and inspect its embedded Actors.
3. Repeat the first entry again.

Expected:

- Each Adventure entry uses its own embedded Actor translations.
- No cross-entry contamination.

### T6. `tokenName` works for embedded Adventure Actors

Goal:

- Validate the main contextual reason for introducing the virtual Adventure `TranslatedCompendium`.

Setup:

- Embedded Adventure Actor with translated `name`.
- Default Actor mapping still includes `tokenName` via converter `name`.

Steps:

1. Open or import the Adventure entry.
2. Inspect the embedded Actor token name.

Expected:

- `prototypeToken.name` is translated consistently with the Actor translated name.
- This should work without requiring a custom static override like `"tokenName": "prototypeToken.name"`.

### T7. Virtual Adventure packs do not leak into global fallback

Goal:

- Verify that virtual per-entry packs are not used accidentally outside their Adventure context.

Setup:

- Use at least one embedded Item or Actor name that also appears elsewhere.

Steps:

1. Open a normal non-Adventure translated Actor or Item pack.
2. Trigger normal `fromPack` resolution outside Adventure context.
3. Compare results with known physical compendium translations.

Expected:

- Non-Adventure translations are not influenced by Adventure virtual packs.
- No wrong translation is picked because of matching names from an Adventure entry.

### T8. Legacy Adventure translation format

Goal:

- Verify that the fix works for legacy `entries` array format, not only object format.

Setup:

- Adventure translation file using legacy array entries with `id`.

Steps:

1. Load the world with the legacy-format translation file.
2. Open or import the Adventure entry.
3. Inspect embedded Item and Actor translations.

Expected:

- Virtual context resolution works with legacy entry arrays.
- No missing translation due to entry-key resolution failure.

### T9. Adventure pack without local embedded translations

Goal:

- Verify that empty embedded sections do not break translation logic.

Setup:

- Adventure entry with no local `items` or `actors` block.

Steps:

1. Open or import the Adventure entry.
2. Inspect embedded documents.

Expected:

- No errors.
- Fallback to physical compendiums still works when applicable.
- Otherwise original data remains intact.

## Suggested execution order

1. T1
2. T3
3. T4
4. T5
5. T6
6. T7
7. T8
8. T9
9. T2

## Exit criteria

- All tests pass without console errors.
- T4 and T5 confirm that multi-entry Adventure packs are isolated per entry.
- T1 and T7 confirm no regression in the classic `fromPack` workflow.
- T6 confirms the Adventure-specific contextual fix is actually effective.
