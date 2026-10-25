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

            // Civitai line: looks the active LoRAs up by file hash and lists their trigger words
            // in a framed box; click a result to put its words in that row's `triggers` field
            const M = 15, PAD = 10, GAP = 10, LINE_H = 17, NUM_W = 20;
            // same text size and font as the rest of the node
            const FONT = `${LiteGraph.NODE_SUBTEXT_SIZE}px ${LiteGraph.DEFAULT_FONT || "sans-serif"}`;
            const civ = { state: "idle", rows: [] };
            const measure = document.createElement("canvas").getContext("2d");
            const fit = () => {
                node.setSize([Math.max(node.size[0], 320), node.computeSize()[1]]);
                node.setDirtyCanvas(true, true);
            };
            // split a result into lines that fit the box; continuation lines align with the text
            const wrap = (text, maxW) => {
                measure.font = FONT;
                const out = [];
                let line = "";
                for (const word of text.split(" ")) {
                    const test = line ? `${line} ${word}` : word;
                    if (line && measure.measureText(test).width > maxW) {
                        out.push(line);
                        line = word;
                    } else line = test;
                }
                if (line) out.push(line);
                return out;
            };
            // wrapped lines and y offset (inside the box) of every result
            const layout = (nodeW) => {
                const maxW = nodeW - 2 * M - 2 * PAD - NUM_W;
                let off = 0;
                return civ.rows.map((r) => {
                    const lines = wrap(r.text, maxW);
                    const block = { r, lines, off };
                    off += lines.length * LINE_H + 2;
                    return block;
                });
            };
            const boxHeight = (nodeW) => {
                const b = layout(nodeW);
                return b.length ? GAP + 2 * PAD + b[b.length - 1].off + b[b.length - 1].lines.length * LINE_H : 0;
            };

            const searchCivitai = async () => {
                if (civ.state === "busy") return;
                const rows = [];
                for (let i = 1; i <= Number(countW.value); i++) {
                    const lora = byName(`lora_${i}`).value;
                    if (lora && lora !== NONE && byName(`on_${i}`).value) rows.push({ i, lora });
                }
                civ.state = "busy";
                civ.rows = rows.map((r) => ({ ...r, text: "Searching...", words: null }));
                fit();
                await Promise.all(civ.rows.map(async (r) => {
                    try {
                        const res = await api.fetchApi(`/mi_lora/civitai?lora=${encodeURIComponent(r.lora)}`);
                        const d = await res.json();
                        if (!res.ok) r.text = d.error || "Error";
                        else if (!d.found) r.text = "Not found on Civitai";
                        else if (!d.words.length) r.text = "No trigger words";
                        else {
                            r.words = d.words.join(", ");
                            r.text = r.words;
                        }
                    } catch (e) {
                        r.text = "Could not reach Civitai";
                    }
                    node.setDirtyCanvas(true, true);
                }));
                civ.state = "idle";
                fit();
            };

            node.addCustomWidget({
                name: "mi_civitai",
                type: "mi_civitai",
                value: null,
                serialize: false,
                options: { serialize: false },
                computeSize: (w) => [w, LiteGraph.NODE_WIDGET_HEIGHT + 4 + boxHeight(node.size?.[0] ?? w)],
                draw(ctx, n, width, y, h) {
                    const w = n.size[0] - 2 * M;
                    this.y = y;
                    this.h = h;
                    const gm = app.canvas?.graph_mouse;
                    const mx = gm ? gm[0] - n.pos[0] : -1;
                    const my = gm ? gm[1] - n.pos[1] : -1;
                    const over = (yy, hh) => my >= yy && my <= yy + hh && mx >= M && mx <= M + w;
                    ctx.textBaseline = "middle";

                    // search button
                    ctx.fillStyle = over(y, h) ? "#E0702D" : LiteGraph.WIDGET_BGCOLOR;
                    ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.roundRect(M, y, w, h, h * 0.5);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                    ctx.font = FONT;
                    ctx.textAlign = "center";
                    ctx.fillText(civ.state === "busy" ? "searching Civitai..." : "search triggers on Civitai", M + w / 2, y + h / 2 + 1);

                    if (!civ.rows.length) return;
                    const blocks = layout(n.size[0]);
                    const top = y + h + 4 + GAP;
                    const boxH = boxHeight(n.size[0]) - GAP;

                    // framed results box
                    ctx.fillStyle = "#353535";
                    ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.rect(M, top, w, boxH);
                    ctx.fill();
                    ctx.stroke();
                    ctx.lineWidth = 1;

                    ctx.textAlign = "left";
                    blocks.forEach(({ r, lines, off }) => {
                        const by = top + PAD + off;
                        const hovered = r.words && over(by, lines.length * LINE_H);
                        // number in orange, bold
                        ctx.font = `bold ${LiteGraph.NODE_SUBTEXT_SIZE + 1}px ${LiteGraph.DEFAULT_FONT || "sans-serif"}`;
                        ctx.fillStyle = "#E0702D";
                        ctx.fillText(String(r.i), M + PAD, by + LINE_H / 2);
                        // text: white, italic when there is nothing to use
                        ctx.font = (r.words ? "" : "italic ") + FONT;
                        ctx.fillStyle = hovered ? "#E0702D" : LiteGraph.WIDGET_TEXT_COLOR;
                        lines.forEach((text, k) => ctx.fillText(text, M + PAD + NUM_W, by + k * LINE_H + LINE_H / 2));
                    });
                },
                mouse(event, pos, n) {
                    if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
                    if (pos[0] < M || pos[0] > n.size[0] - M || this.y == null) return false;
                    if (pos[1] >= this.y && pos[1] <= this.y + this.h) {
                        searchCivitai();
                        return true;
                    }
                    const ry = pos[1] - (this.y + this.h + 4 + GAP + PAD);
                    const hit = layout(n.size[0]).find((b) => ry >= b.off && ry < b.off + b.lines.length * LINE_H);
                    const r = hit?.r;
                    if (r && r.words) {
                        byName(`triggers_${r.i}`).value = r.words;
                        saveTriggers(byName(`lora_${r.i}`).value, r.words);
                        n.setDirtyCanvas(true, true);
                        return true;
                    }
                    return false;
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
