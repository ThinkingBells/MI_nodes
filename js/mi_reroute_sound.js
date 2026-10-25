import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE = "MI_reroute_sound";
const NONE = "(none)";

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

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            play(message?.mi_sound?.[0]);
        };
    },
});
