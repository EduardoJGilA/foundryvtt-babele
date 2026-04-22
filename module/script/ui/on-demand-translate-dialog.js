/**
 *
 */
export class OnDemandTranslateDialog {

    static translatedPackFor(documentType, data, translatedPacks) {
        return game.babele.translatedPackFor(documentType, data, {
            registry: translatedPacks,
        });
    }

    constructor(actor) {
        this.actor = actor;
    }

    render(force = true) {
        return new foundry.applications.api.DialogV2({
            window: {
                title: game.i18n.localize("BABELE.TranslateActorTitle"),
            },
            position: {
                width: 600,
            },
            form: {
                closeOnSubmit: false,
            },
            content: `
                <p>${game.i18n.localize("BABELE.TranslateActorHint")}</p>
                <textarea
                    rows="10"
                    cols="50"
                    name="actor-translate-log"
                    style="font-family: Courier, monospace"
                ></textarea>
            `,
            buttons: [{
                action: "translate",
                icon: "fas fa-globe",
                label: game.i18n.localize("BABELE.TranslateActorBtn"),
                default: true,
                callback: async (_event, button) => {
                    await this.#translate(button?.form?.elements?.["actor-translate-log"]);
                },
            }],
        }).render({force});
    }

    async #translate(area) {
        if (!area) {
            ui.notifications?.error?.("Babele | unable to locate the actor translation log area");
            return;
        }

        area.textContent += "start...\n";
        const items = this.actor.items.contents.length;
        let translated = 0;
        let untranslated = 0;

        const translatedPacks = game.babele.mappedCompendiums?.matching?.((pack) => pack.translated)
            ?? [];
        const updates = [];

        for (let idx = 0; idx < items; idx++) {
            const item = this.actor.items.contents[idx];
            const data = item.toObject();
            const pack = OnDemandTranslateDialog.translatedPackFor("Item", data, translatedPacks);

            if (pack) {
                const translatedData = pack.translate(data, true);
                updates.push(foundry.utils.mergeObject(translatedData, {_id: item.id}));
                area.textContent += `${data.name.padEnd(68, ".")}ok\n`;
                translated++;
            } else {
                area.textContent += `${data.name.padEnd(61, ".")}not found\n`;
                untranslated++;
            }
        }

        if (updates.length) {
            area.textContent += "Updating...\n";
            await this.actor.updateEmbeddedDocuments("Item", updates);
        }

        area.textContent += `\nDone. tot items: ${items}, tot translated: ${translated}, tot untranslated: ${untranslated}\n`;
        area.scrollTop = area.scrollHeight;
    }
}
