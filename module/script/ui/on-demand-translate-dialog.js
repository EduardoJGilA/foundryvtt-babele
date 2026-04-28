import {ActorTranslation} from "../actor/actor-translation.js";

/**
 *
 */
export class OnDemandTranslateDialog {
    constructor(actor, actorTranslation = new ActorTranslation(game.babele)) {
        this.actor = actor;
        this.actorTranslation = actorTranslation;
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

        const proposal = this.#proposal();
        area.textContent += "start...\n";

        for (const entry of proposal.entries) {
            if (entry.translated) {
                area.textContent += `${entry.name().padEnd(68, ".")}ok\n`;
            } else {
                area.textContent += `${entry.name().padEnd(61, ".")}not found\n`;
            }
        }

        if (proposal.updates().length) {
            area.textContent += "Updating...\n";
            await this.#apply(proposal);
        }

        const summary = proposal.summary();
        area.textContent += `\nDone. tot items: ${summary.total}, tot translated: ${summary.translated}, tot untranslated: ${summary.untranslated}\n`;
        area.scrollTop = area.scrollHeight;
    }

    #proposal() {
        return game.babele?.proposeActorTranslation?.(this.actor) ?? this.actorTranslation.proposal(this.actor);
    }

    async #apply(proposal) {
        return game.babele?.applyActorTranslation?.(proposal) ?? this.actorTranslation.apply(proposal);
    }
}
