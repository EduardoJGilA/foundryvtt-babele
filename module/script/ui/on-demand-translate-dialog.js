import {ActorTranslation} from "../actor/actor-translation.js";

function localizeWithFallback(key, fallback) {
    const localized = game.i18n.localize(key);
    return localized === key ? fallback : localized;
}

/**
 * ApplicationV2 review UI for on-demand Actor translation.
 */
export class OnDemandTranslateDialog extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "babele-actor-translation-{id}",
        classes: ["babele", "babele-actor-translation-app"],
        window: {
            title: "BABELE.TranslateActorTitle",
            icon: "fas fa-globe",
            minimizable: false,
            resizable: true,
        },
        position: {
            width: 760,
            height: "auto",
        },
    };

    constructor(actor, actorTranslation = new ActorTranslation(game.babele), options = {}) {
        super(options);
        this.actor = actor;
        this.actorTranslation = actorTranslation;
        this.proposal = null;
        this.#selectedEntryIds = new Set();
        this.#selectionInitialized = false;
        this.#activeFilter = "all";
    }

    #selectedEntryIds
    #selectionInitialized
    #activeFilter

    render(force = true) {
        return super.render({force});
    }

    async _prepareContext(_options) {
        const proposal = this.#proposal();
        const summary = proposal.summary();
        const texts = this.#texts();

        this.#initializeSelection(proposal);

        const entries = proposal.entries.map((entry) => this.#entryContext(entry, texts));

        return {
            actorName: this.actor.name ?? "",
            summary,
            entries,
            hasEntries: entries.length > 0,
            hasTranslated: summary.translated > 0,
            hasReady: summary.ready > 0,
            selectedCount: this.#selectedEntries().length,
            filters: [
                this.#filterContext("all", texts.all, summary.total),
                this.#filterContext("ready", texts.ready, summary.ready),
                this.#filterContext("translated", texts.translated, summary.translated),
                this.#filterContext("missing", texts.missing, summary.untranslated),
            ],
            texts,
        };
    }

    async _renderHTML(context, _options) {
        const html = await foundry.applications.handlebars.renderTemplate(
            "modules/babele/templates/on-demand-translate-dialog.html",
            context,
        );
        const element = document.createElement("div");
        element.innerHTML = html;
        return element.firstElementChild ?? element;
    }

    _replaceHTML(result, content, _options) {
        content.replaceChildren(result);
    }

    async _onRender(context, options) {
        if (typeof super._onRender === "function") {
            await super._onRender(context, options);
        }
        this.#activateListeners(this.element);
    }

    #activateListeners(root) {
        if (!root) {
            return;
        }

        root.addEventListener("change", (event) => {
            const candidateSelector = event.target?.closest?.("[data-candidate-selector]");
            if (candidateSelector) {
                event.preventDefault?.();
                event.stopImmediatePropagation?.();
                event.stopPropagation?.();
                const entry = this.#selectCandidate(candidateSelector.dataset.entryId, candidateSelector.value);
                this.#refreshCandidateChoice(root, entry);
                return;
            }

            const selector = event.target?.closest?.("[data-entry-selector]");
            if (!selector) {
                return;
            }

            if (selector.checked) {
                this.#selectedEntryIds.add(selector.dataset.entryId);
            } else {
                this.#selectedEntryIds.delete(selector.dataset.entryId);
            }

            this.#refreshActions(root);
        }, {capture: true});

        root.addEventListener("click", async (event) => {
            const action = event.target?.closest?.("[data-action]")?.dataset.action;
            if (!action) {
                return;
            }

            event.preventDefault();
            if (action === "select-all") {
                this.#selectAll(root);
            } else if (action === "select-none") {
                this.#selectNone(root);
            } else if (action === "filter") {
                this.#applyFilter(root, event.target.closest("[data-filter]")?.dataset.filter ?? "all");
            } else if (action === "apply-selected") {
                await this.#applySelected();
            } else if (action === "cancel") {
                await this.close?.();
            }
        });

        this.#refreshActions(root);
        this.#applyFilter(root, this.#activeFilter);
    }

    #proposal() {
        this.proposal ??= game.babele?.proposeActorTranslation?.(this.actor) ?? this.actorTranslation.proposal(this.actor);
        return this.proposal;
    }

    async #applySelected() {
        const selectedEntries = this.#selectedEntries();
        if (selectedEntries.length === 0) {
            return [];
        }

        const updates = await (game.babele?.applyActorTranslation?.(this.proposal, {entries: selectedEntries})
            ?? this.actorTranslation.apply(this.proposal, {entries: selectedEntries}));
        await this.close?.({submitted: true});
        return updates;
    }

    #initializeSelection(proposal) {
        if (this.#selectionInitialized) {
            return;
        }

        for (const entry of proposal.translatedEntries()) {
            this.#selectedEntryIds.add(entry.id());
        }
        this.#selectionInitialized = true;
    }

    #selectedEntries() {
        return this.#proposal().translatedEntries()
            .filter((entry) => this.#selectedEntryIds.has(entry.id()));
    }

    #selectAll(root) {
        for (const entry of this.#proposal().translatedEntries()) {
            this.#selectedEntryIds.add(entry.id());
        }

        for (const selector of root.querySelectorAll("[data-entry-selector]")) {
            selector.checked = !selector.disabled;
        }

        this.#refreshActions(root);
    }

    #selectNone(root) {
        this.#selectedEntryIds.clear();

        for (const selector of root.querySelectorAll("[data-entry-selector]")) {
            selector.checked = false;
        }

        this.#refreshActions(root);
    }

    #selectCandidate(entryId, candidateId) {
        const entry = this.#proposal().entries.find((candidate) => candidate.id() === entryId);
        if (!entry?.selectCandidate(candidateId)) {
            return null;
        }

        if (!entry.applicable()) {
            this.#selectedEntryIds.delete(entry.id());
        }

        return entry;
    }

    #refreshCandidateChoice(root, entry) {
        if (!entry) {
            return;
        }

        const texts = this.#texts();
        const context = this.#entryContext(entry, texts);
        const row = root.querySelector(`[data-entry-id="${context.id}"]`);
        if (!row) {
            return;
        }

        row.className = `babele-actor-translation__entry ${context.cssClass}`;
        row.dataset.entryFilter = context.filter;
        row.hidden = this.#activeFilter !== "all" && this.#activeFilter !== context.filter;

        const proposedName = row.querySelector("[data-proposed-name]");
        if (proposedName) {
            proposedName.textContent = context.proposedName;
            proposedName.classList.toggle?.("is-missing", context.proposedMissing);
        }

        const status = row.querySelector("[data-entry-status]");
        if (status) {
            status.textContent = context.status;
        }

        const selector = row.querySelector("[data-entry-selector]");
        if (selector) {
            selector.disabled = !context.applicable;
            selector.checked = context.selected;
        }

        const candidateSelector = row.querySelector("[data-candidate-selector]");
        if (candidateSelector) {
            candidateSelector.disabled = !context.candidateChoiceEnabled;
        }

        this.#refreshSummary(root);
        this.#refreshActions(root);
        this.#applyFilter(root, this.#activeFilter);
    }

    #entryContext(entry, texts) {
        const translated = entry.hasTranslation();
        const applicable = entry.applicable();
        const unchanged = entry.translated && !entry.changed;
        const filter = applicable ? "ready" : translated ? "translated" : "missing";
        const id = entry.id();
        const originalName = entry.name();
        const currentName = entry.currentName();
        const candidates = entry.candidates.map((candidate) => ({
            id: candidate.id,
            label: candidate.packLabel() || candidate.id,
            proposedName: candidate.proposedName(originalName),
            selected: candidate.id === entry.selectedCandidateId,
        }));
        const hasCandidates = candidates.length > 0;

        return {
            id,
            originalName,
            currentName,
            hasCurrentTranslation: translated && !!currentName && currentName !== originalName,
            proposedName: hasCandidates ? entry.proposedName() : texts.missing,
            proposedMissing: !hasCandidates,
            itemType: entry.type(),
            translated,
            alreadyTranslated: entry.alreadyTranslated,
            applicable,
            selected: applicable && this.#selectedEntryIds.has(id),
            unchanged,
            filter,
            cssClass: entry.alreadyTranslated ? "is-already" : unchanged ? "is-unchanged" : translated ? "is-translated" : "is-missing",
            status: entry.alreadyTranslated ? texts.already : unchanged ? texts.unchanged : translated ? texts.ready : texts.missing,
            packLabel: entry.packLabel(),
            candidates,
            hasCandidates,
            hasCandidateChoices: candidates.length > 1,
            candidateChoiceEnabled: applicable && candidates.length > 1,
        };
    }

    #refreshActions(root) {
        const selectedCount = this.#selectedEntries().length;
        const applyButton = root.querySelector('[data-action="apply-selected"]');
        if (applyButton) {
            applyButton.disabled = selectedCount === 0;
        }

        const selectedCountElement = root.querySelector("[data-selected-count]");
        if (selectedCountElement) {
            selectedCountElement.textContent = String(selectedCount);
        }

        const summary = this.#proposal().summary();
        for (const button of root.querySelectorAll('[data-action="select-all"], [data-action="select-none"]')) {
            button.disabled = summary.ready === 0;
        }
    }

    #refreshSummary(root) {
        const summary = this.#proposal().summary();
        for (const key of ["total", "ready", "translated", "untranslated"]) {
            const element = root.querySelector(`[data-summary-${key}]`);
            if (element) {
                element.textContent = String(summary[key]);
            }
        }

        const filterCounts = {
            all: summary.total,
            ready: summary.ready,
            translated: summary.translated,
            missing: summary.untranslated,
        };

        for (const [filter, count] of Object.entries(filterCounts)) {
            const element = root.querySelector(`[data-filter-count="${filter}"]`);
            if (element) {
                element.textContent = String(count);
            }
        }
    }

    #filterContext(filter, label, count) {
        return {
            filter,
            label,
            count,
            active: this.#activeFilter === filter,
        };
    }

    #applyFilter(root, filter) {
        this.#activeFilter = ["all", "ready", "translated", "missing"].includes(filter) ? filter : "all";

        for (const entry of root.querySelectorAll("[data-entry-filter]")) {
            entry.hidden = this.#activeFilter !== "all" && entry.dataset.entryFilter !== this.#activeFilter;
        }

        for (const button of root.querySelectorAll("[data-filter]")) {
            const active = button.dataset.filter === this.#activeFilter;
            button.setAttribute("aria-pressed", String(active));
            button.dataset.active = active ? "true" : "false";
        }
    }

    #texts() {
        return {
            intro: localizeWithFallback(
                "BABELE.ActorTranslationIntro",
                "Review the item translations found for this Actor and choose which ones to apply.",
            ),
            translated: localizeWithFallback("BABELE.ActorTranslationTranslated", "Translated"),
            missing: localizeWithFallback("BABELE.ActorTranslationMissing", "Missing"),
            already: localizeWithFallback("BABELE.ActorTranslationAlready", "Translated"),
            unchanged: localizeWithFallback("BABELE.ActorTranslationUnchanged", "No changes"),
            selected: localizeWithFallback("BABELE.ActorTranslationSelected", "Selected"),
            all: localizeWithFallback("BABELE.ActorTranslationAll", "All"),
            total: localizeWithFallback("BABELE.ActorTranslationTotal", "Total"),
            ready: localizeWithFallback("BABELE.ActorTranslationReady", "Ready"),
            original: localizeWithFallback("BABELE.ActorTranslationOriginal", "Original"),
            proposed: localizeWithFallback("BABELE.ActorTranslationProposed", "Proposed"),
            current: localizeWithFallback("BABELE.ActorTranslationCurrent", "Current"),
            type: localizeWithFallback("BABELE.ActorTranslationType", "Type"),
            from: localizeWithFallback("BABELE.ActorTranslationFrom", "From"),
            selectAll: localizeWithFallback("BABELE.ActorTranslationSelectAll", "Select All"),
            selectNone: localizeWithFallback("BABELE.ActorTranslationSelectNone", "Select None"),
            apply: localizeWithFallback("BABELE.ActorTranslationApplySelected", "Apply Selected"),
            cancel: localizeWithFallback("BABELE.ActorTranslationCancel", "Cancel"),
            empty: localizeWithFallback("BABELE.ActorTranslationEmpty", "This Actor has no embedded Items to translate."),
            actor: localizeWithFallback("BABELE.ActorTranslationActor", "Actor"),
        };
    }
}
