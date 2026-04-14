import {HtmlUtils} from "./html-utils.js";

/**
 * UI hook bridge that isolates Foundry render hooks from the Babele facade.
 */
export class BabeleUiBridge {

    registerHooks() {
        Hooks.on("getActorSheetHeaderButtons", (app, buttons) => this.extendLegacyActorSheetHeaderButtons(app, buttons));
        Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => this.extendActorSheetHeaderControls(sheet, controls));
        Hooks.on("getHeaderControlsCompendium", (app, controls) => this.extendCompendiumHeaderControls(app, controls));
        Hooks.on("renderCompendium", (app, html, data) => this.renderCompendium(app, html, data));
    }

    /**
     * Inject the legacy ApplicationV1 actor-sheet header button.
     *
     * @param {Application} app
     * @param {Array<object>} buttons
     */
    extendLegacyActorSheetHeaderButtons(app, buttons) {
        if (!this.#canTranslateActorSheet(app?.options?.editable)) {
            return;
        }

        if (buttons.some((button) => button?.class === "babele-translate-actor")) {
            return;
        }

        buttons.unshift({
            label: game.i18n.localize("BABELE.TranslateActorHeadBtn"),
            class: "babele-translate-actor",
            icon: "fas fa-globe",
            onclick: () => game.babele.translateActor(app.actor),
        });
    }

    /**
     * Inject the ApplicationV2 actor-sheet header control.
     *
     * @param {ApplicationV2} sheet
     * @param {Array<object>} controls
     */
    extendActorSheetHeaderControls(sheet, controls) {
        if (!this.#canTranslateActorSheet(sheet?.isEditable)) {
            return;
        }

        if (controls.some((control) => control?.action === "babele-translate-actor")) {
            return;
        }

        controls.push({
            action: "babele-translate-actor",
            icon: "fas fa-globe",
            label: game.i18n.localize("BABELE.TranslateActorHeadBtn"),
            onClick: () => game.babele.translateActor(sheet.actor),
        });
    }

    /**
     * Inject the ApplicationV2 compendium header control.
     *
     * @param {ApplicationV2} app
     * @param {Array<object>} controls
     */
    extendCompendiumHeaderControls(app, controls) {
        if (!this.#canExportCompendium()) {
            return;
        }

        if (controls.some((control) => control?.action === "babele-export-translations")) {
            return;
        }

        controls.push({
            action: "babele-export-translations",
            icon: "fas fa-globe",
            label: game.i18n.localize("BABELE.CompendiumTranslations"),
            onClick: () => game.babele.exportTranslationsFile(app.collection),
        });
    }

    /**
     * Render original-name hints for translated compendium entries.
     *
     * @param {Application} app
     * @param {HTMLElement|jQuery} html
     * @param {object} data
     */
    renderCompendium(app, html, data) {
        const root = HtmlUtils.element(html);
        if (!root) {
            return;
        }

        if (!game.settings.get("babele", "showOriginalName")) {
            return;
        }

        const index = Array.isArray(data?.collection?.index) ? data.collection.index : [];
        const entriesById = new Map(
            index
                .map((entry) => [entry?._id ?? entry?.id, entry])
                .filter(([id]) => !!id),
        );

        root
            .querySelectorAll(".directory-list .entry-name, .directory-list .document-name")
            .forEach((item) => {
                const entry = this.#compendiumEntryFor(item, entriesById, index);
                if (!entry?.translated || !entry?.hasTranslation || !entry?.originalName) {
                    return;
                }

                HtmlUtils.appendOriginalName(item, entry.originalName);
            });
    }

    #canTranslateActorSheet(editable) {
        return game.settings.get("babele", "showTranslateOption") && game.user.isGM && editable;
    }

    #canExportCompendium() {
        return game.user.isGM && game.settings.get("babele", "export");
    }

    #compendiumEntryFor(item, entriesById, index) {
        const row = item.closest?.("[data-entry-id], [data-document-id]");
        const entryId = row?.dataset?.entryId ?? row?.dataset?.documentId;
        if (entryId && entriesById.has(entryId)) {
            return entriesById.get(entryId);
        }

        const text = item.firstChild?.nodeType === 3 ? item.firstChild.textContent?.trim() : item.textContent?.trim();
        if (!text) {
            return null;
        }

        return index.find((entry) => entry?.name === text) ?? null;
    }
}
