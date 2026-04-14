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
        target.style.display = "flex";
        target.style.flexDirection = "column";
        target.style.alignItems = "flex-start";
        target.style.lineHeight = "normal";
        target.style.paddingTop = "2px";
        target.style.whiteSpace = "normal";
        target.style.overflow = "visible";
        target.style.textOverflow = "initial";

        const label = document.createElement("span");
        label.className = "babele-original-name";
        label.style.display = "block";
        label.style.lineHeight = "normal";
        label.style.fontSize = "12px";
        label.style.color = "gray";
        label.textContent = text;
        target.appendChild(label);
    }
}
