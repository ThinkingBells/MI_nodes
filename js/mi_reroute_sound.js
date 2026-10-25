import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE = "MI_reroute_sound";
const NONE = "(none)";
const NOTE = "♪";
const ACCENT = "#e0702d";

function play(name) {
    if (!name || name === NONE) return;
    const audio = new Audio(api.apiURL(`/mi_sound/${encodeURIComponent(name)}`));
    audio.play().catch(() => {});
}

app.registerExtension({
    name: "MI.reroute_sound",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;
            const combo = node.widgets?.find((w) => w.name === "sound");
            if (combo) {
                // hear the sound when you pick it
                const cb = combo.callback;
                combo.callback = function (value) {
                    cb?.apply(this, arguments);
                    play(value);
                };
            }
            node.setSize([190, 56]);
        };

        // title text with an orange musical note at the end
        nodeType.prototype.onDrawTitleText = function (ctx, titleHeight, size, scale, fontStyle, selected) {
            if (scale < 0.5) return;
            const LG = window.LiteGraph;
            const baseline = (LG?.NODE_TITLE_TEXT_Y ?? 20) - titleHeight;
            const text = (this.getTitle?.() ?? this.title ?? "").replace(/\s*♪$/, "");
            ctx.font = fontStyle;
            ctx.textAlign = "left";
            ctx.fillStyle = selected
                ? (LG?.NODE_SELECTED_TITLE_COLOR ?? "#FFF")
                : (this.constructor.title_text_color || app.canvas?.node_title_color || "#AAA");
            ctx.fillText(text, titleHeight, baseline);
            ctx.fillStyle = ACCENT;
            ctx.fillText(NOTE, titleHeight + ctx.measureText(`${text} `).width, baseline);
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            play(message?.mi_sound?.[0]);
        };
    },
});
