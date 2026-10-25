import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE = "MI_reroute_sound";
const NONE = "(none)";
const NOTE = "♪";
const ACCENT = "#e0702d";

// compact title: "♪ ding" (or just "♪" when no sound is chosen)
function setTitle(node) {
    const sound = node.widgets?.find((w) => w.name === "sound")?.value;
    const name = sound && sound !== NONE ? sound.replace(/\.wav$/i, "") : "";
    node.title = name ? `${NOTE} ${name}` : NOTE;
}

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
                    setTitle(node);
                    node.setDirtyCanvas?.(true, true);
                    play(value);
                };
            }
            node.setSize([190, 56]);
            setTitle(node);
            // new nodes start collapsed (a loaded workflow restores its own state afterwards)
            node.collapse?.(true);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            setTitle(this);
        };

        // orange musical note followed by the sound name in the normal title colour
        nodeType.prototype.onDrawTitleText = function (ctx, titleHeight, size, scale, fontStyle, selected) {
            if (scale < 0.5) return;
            const LG = window.LiteGraph;
            const baseline = (LG?.NODE_TITLE_TEXT_Y ?? 20) - titleHeight;
            const title = this.getTitle?.() ?? this.title ?? "";
            const rest = title.replace(/^♪\s*/, "");
            ctx.font = fontStyle;
            ctx.textAlign = "left";
            ctx.fillStyle = ACCENT;
            ctx.fillText(NOTE, titleHeight, baseline);
            if (!rest) return;
            ctx.fillStyle = selected
                ? (LG?.NODE_SELECTED_TITLE_COLOR ?? "#FFF")
                : (this.constructor.title_text_color || app.canvas?.node_title_color || "#AAA");
            ctx.fillText(rest, titleHeight + ctx.measureText(`${NOTE} `).width, baseline);
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            play(message?.mi_sound?.[0]);
        };
    },
});
