import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MAX_ROWS = 8;
const NONE = "(none)";

let cache = {};
const loadCache = async () => {
    try {
        const r = await api.fetchApi("/mi_lora/triggers");
        if (r.ok) cache = await r.json();
    } catch (e) {
        console.warn("MI_lora: could not load trigger words", e);
    }
};

const saveTriggers = async (lora, triggers) => {
    if (!lora || lora === NONE) return;
    triggers = (triggers || "").trim();
    if (triggers) cache[lora] = triggers;
    else delete cache[lora];
    try {
        await api.fetchApi("/mi_lora/triggers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lora, triggers }),
        });
    } catch (e) {
        console.warn("MI_lora: could not save trigger words", e);
    }
};

app.registerExtension({
    name: "MI.lora",

    async setup() {
        await loadCache();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "MI_lora") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;
            const byName = (n) => node.widgets.find((w) => w.name === n);
            const countW = byName("count");
            const hide = (w) => {
                if (w.miHidden) return;
                w.miHidden = true;
                w.miType = w.type;
                w.miCompute = w.computeSize;
                w.type = "hidden";
                w.hidden = true;
                w.computeSize = () => [0, -4];
            };
            const show = (w) => {
                if (!w.miHidden) return;
                w.miHidden = false;
                w.type = w.miType;
                w.hidden = false;
                if (w.miCompute) w.computeSize = w.miCompute;
                else delete w.computeSize;
            };
            hide(countW);

            // a row that is switched off greys out its fields
            const syncRow = (i) => {
                const off = !byName(`on_${i}`).value;
                for (const n of ["lora", "strength", "triggers"]) byName(`${n}_${i}`).disabled = off;
                node.setDirtyCanvas(true, true);
            };

            for (let i = 1; i <= MAX_ROWS; i++) {
                const loraW = byName(`lora_${i}`);
                const trigW = byName(`triggers_${i}`);
                const onW = byName(`on_${i}`);
                onW.label = `lora ${i} active`;
                const onOn = onW.callback;
                onW.callback = function () {
                    onOn?.apply(this, arguments);
                    syncRow(i);
                };
                loraW.label = `lora ${i}`;
                byName(`strength_${i}`).label = `strength ${i}`;
                trigW.label = `triggers ${i}`;

                // choosing a lora loads its saved trigger words
                const onLora = loraW.callback;
                loraW.callback = function (value) {
                    onLora?.apply(this, arguments);
                    trigW.value = cache[value] || "";
                    node.setDirtyCanvas(true, true);
                };
                // editing the trigger words saves them for the selected lora
                const onTrig = trigW.callback;
                trigW.callback = function (value) {
                    onTrig?.apply(this, arguments);
                    saveTriggers(loraW.value, value);
                };
            }

            const applyCount = (count) => {
                count = Math.max(1, Math.min(MAX_ROWS, Number(count) || 1));
                countW.value = count;
                for (let i = 1; i <= MAX_ROWS; i++) {
                    const fn = i <= count ? show : hide;
                    fn(byName(`on_${i}`));
                    fn(byName(`lora_${i}`));
                    fn(byName(`strength_${i}`));
                    fn(byName(`triggers_${i}`));
                    syncRow(i);
                }
                node.setSize([Math.max(node.size[0], 320), node.computeSize()[1]]);
                node.setDirtyCanvas(true, true);
            };

            // +/- buttons drawn by hand so the labels are centered
            node.addCustomWidget({
                name: "mi_buttons",
                type: "mi_buttons",
                value: null,
                serialize: false,
                options: { serialize: false },
                computeSize: (w) => [w, LiteGraph.NODE_WIDGET_HEIGHT + 4],
                draw(ctx, n, width, y, h) {
                    const m = 15, gap = 6;
                    const bw = (n.size[0] - 2 * m - gap) / 2;
                    this.layout = { m, bw, gap };
                    const gm = app.canvas?.graph_mouse;
                    const mx = gm ? gm[0] - n.pos[0] : -1;
                    const my = gm ? gm[1] - n.pos[1] : -1;
                    const overRow = my >= y && my <= y + h;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    [["−", m], ["+", m + bw + gap]].forEach(([label, x]) => {
                        const hover = overRow && mx >= x && mx <= x + bw;
                        ctx.fillStyle = hover ? "#E0702D" : LiteGraph.WIDGET_BGCOLOR;
                        ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
                        ctx.beginPath();
                        ctx.roundRect(x, y, bw, h, h * 0.5);
                        ctx.fill();
                        ctx.stroke();
                        ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                        ctx.font = "bold 16px sans-serif";
                        ctx.fillText(label, x + bw / 2, y + h / 2 + 1);
                    });
                },
                mouse(event, pos, n) {
                    if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
                    const L = this.layout;
                    if (!L) return false;
                    if (pos[0] >= L.m && pos[0] <= L.m + L.bw) applyCount(countW.value - 1);
                    else if (pos[0] >= L.m + L.bw + L.gap && pos[0] <= L.m + 2 * L.bw + L.gap) applyCount(countW.value + 1);
                    else return false;
                    return true;
                },
            });

            // redraw while the mouse moves over the node so the button hover updates
            node.onMouseMove = () => node.setDirtyCanvas(true, false);

            applyCount(1);

            const onConfigure = node.onConfigure;
            node.onConfigure = function () {
                onConfigure?.apply(this, arguments);
                applyCount(countW.value);
            };
        };
    },
});
