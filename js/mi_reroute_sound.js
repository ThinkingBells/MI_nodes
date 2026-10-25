import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE = "MI_reroute_sound";
const NONE = "(none)";
const NOTE = "♪";
const ACCENT = "#e0702d";

// compact title: just the note
function setTitle(node) {
    node.title = NOTE;
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
                    play(value);
                };
            }
            node.setSize([190, 56]);
            setTitle(node);
            // new nodes start collapsed (a loaded workflow restores its own state afterwards);
            // set the flag directly: collapse() needs the node to be in a graph already
            node.flags = node.flags || {};
            node.flags.collapsed = true;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            setTitle(this);
        };

        // orange musical note as the whole title
        nodeType.prototype.onDrawTitleText = function (ctx, titleHeight, size, scale, fontStyle) {
            if (scale < 0.5) return;
            const baseline = (window.LiteGraph?.NODE_TITLE_TEXT_Y ?? 20) - titleHeight;
            ctx.font = fontStyle;
            ctx.textAlign = "left";
            ctx.fillStyle = ACCENT;
            ctx.fillText(NOTE, titleHeight, baseline);
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            play(message?.mi_sound?.[0]);
        };
    },
});
