/**
 * Small DOM helpers used by Babele UI integrations.
 */
export class HtmlUtils {

    /**
     * Normalize jQuery-wrapped and plain HTMLElement inputs.
     *
     * @param {HTMLElement|jQuery} html
     * @returns {HTMLElement|null}
     */
    static element(html) {
        return html?.[0] ?? html ?? null;
    }

    /**
     * Append or replace the original-name secondary label on a compendium entry.
     *
     * @param {HTMLElement} target
     * @param {string} text
     */
    static appendOriginalName(target, text) {
        if (!target || !text) {
            return;
        }

        target.querySelector(".babele-original-name")?.remove();
        target.style.lineHeight = "normal";
        target.style.paddingTop = "10px";

        const label = document.createElement("div");
        label.className = "babele-original-name";
        label.style.lineHeight = "normal";
        label.style.fontSize = "12px";
        label.style.color = "gray";
        label.textContent = text;
        target.appendChild(label);
    }
}
