import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MARGIN = 15;
const BTN_W = 130;
const BTN_H = 30;
const ROW_H = BTN_H + 4;
const btnX = (nodeWidth) => nodeWidth - MARGIN - BTN_W;
const ACCENT = "#e0702d";
const WF_LABEL = "Save Workflow";
const SW_W = 34;
const SW_H = 18;

// the sounds live in the package's sounds/ folder (same ones as MI Reroute Sound)
function playSound(name) {
    if (!name || name === "(none)") return;
    new Audio(api.apiURL(`/mi_sound/${encodeURIComponent(name)}`)).play().catch(() => {});
}

app.registerExtension({
    name: "MIsave_image.SaveButton",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "MIsave_image") return;

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            this._misaveImages = message?.images ?? [];
            // an image is ready: play the chosen sound
            if (this._misaveImages.length) playSound(message?.mi_sound?.[0]);
        };

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);

            const node = this;
            let widget; // the widget instance ComfyUI actually keeps (set below)

            // hear the sound when you pick it
            const soundW = node.widgets?.find((w) => w.name === "sound");
            if (soundW) {
                const cb = soundW.callback;
                soundW.callback = function (value) {
                    cb?.apply(this, arguments);
                    playSound(value);
                };
            }
            const flash = (text) => {
                widget.label = text;
                node.setDirtyCanvas(true, true);
                setTimeout(() => { widget.label = "SAVE"; node.setDirtyCanvas(true, true); }, 2000);
            };

            // "Save Workflow" switch (same look as MI Compare 3 Images): on = the workflow
            // stays embedded in the saved PNG, off = it is stripped. Stored with the node.
            const workflowOn = () => node.properties?.saveWorkflow !== false;
            const toggleWorkflow = () => {
                node.properties = node.properties || {};
                node.properties.saveWorkflow = !workflowOn();
                node.setDirtyCanvas(true, true);
            };
            const switchBox = (y) => {
                const ctx = document.createElement("canvas").getContext("2d");
                ctx.font = "11px sans-serif";
                const labelW = ctx.measureText(WF_LABEL).width;
                return { labelX: MARGIN, labelW, x: MARGIN + labelW + 8, y: y + 2 + (BTN_H - SW_H) / 2 };
            };
            const overSwitch = (pos, y) => {
                const b = switchBox(y);
                return pos[0] >= b.labelX && pos[0] <= b.x + SW_W
                    && pos[1] >= y + 2 && pos[1] <= y + 2 + BTN_H;
            };

            const save = async () => {
                widget.pressed = true;
                node.setDirtyCanvas(true, true);
                const t0 = Date.now();
                try {
                    await doSave();
                } finally {
                    setTimeout(() => { widget.pressed = false; node.setDirtyCanvas(true, true); },
                        Math.max(0, 1000 - (Date.now() - t0)));
                }
            };

            const doSave = async () => {
                let images = node._misaveImages ?? [];
                // Single-image view (e.g. "1/2") -> only the visible image; grid view -> all.
                const idx = node.imageIndex;
                if (idx != null && images[idx]) images = [images[idx]];
                if (!images.length) return flash("Run first");
                const prefix = node.widgets.find((w) => w.name === "filename_prefix")?.value;
                try {
                    const res = await api.fetchApi("/MIsave_image/save", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ images, filename_prefix: prefix, save_workflow: workflowOn() }),
                    });
                    const data = await res.json();
                    flash(res.ok ? "SAVED" : "ERROR");
                    if (res.ok) playSound("c1.wav"); // confirmation sound when SAVE copies the image
                    if (!res.ok) console.error("[MIsave_image]", data.error);
                } catch (e) {
                    flash("ERROR");
                    console.error("[MIsave_image]", e);
                }
            };

            const spec = {
                type: "misave_button",
                name: "SAVE",
                label: "SAVE",
                value: null,
                options: { serialize: false },
                serialize: false,
                pressed: false,
                hover: false,
                computeSize: (width) => [width, ROW_H],
                computeLayoutSize: () => ({ minHeight: ROW_H, maxHeight: ROW_H, minWidth: BTN_W + 2 * MARGIN }),
                draw(ctx, drawNode, _width, y) {
                    const x = btnX(drawNode.size[0]);
                    const h = BTN_H;
                    ctx.save();
                    ctx.fillStyle = this.pressed ? ACCENT : this.hover ? ACCENT : "#3a3a3a";
                    ctx.strokeStyle = "#666";
                    ctx.beginPath();
                    ctx.roundRect(x, y + 2, BTN_W, h, 6);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = this.pressed || this.hover ? "#fff" : "#ddd";
                    ctx.font = "bold 12px sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(this.label, x + BTN_W / 2, y + 2 + h / 2);

                    // Save Workflow label + switch, on the left of the same row
                    const on = workflowOn();
                    const b = switchBox(y);
                    ctx.font = "11px sans-serif";
                    ctx.textAlign = "left";
                    ctx.fillStyle = "#aaa";
                    ctx.fillText(WF_LABEL, b.labelX, y + 2 + h / 2);
                    ctx.fillStyle = on ? ACCENT : "#3a3c3e";
                    ctx.strokeStyle = on ? ACCENT : "#555";
                    ctx.beginPath();
                    ctx.roundRect(b.x, b.y, SW_W, SW_H, SW_H / 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = on ? "#fff" : "#bbb";
                    ctx.beginPath();
                    ctx.arc(b.x + (on ? SW_W - SW_H / 2 : SW_H / 2), b.y + SW_H / 2, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                },
                mouse(event, pos, node) {
                    if (event.type !== "pointerdown" && event.type !== "mousedown") return false;
                    if (overSwitch(pos, widget.y)) {
                        toggleWorkflow();
                        return true;
                    }
                    const x = btnX(node.size[0]);
                    if (pos[0] >= x && pos[0] <= x + BTN_W) {
                        save();
                        return true;
                    }
                    return false;
                },
            };
            // ComfyUI overwrites widget.width during layout, and the click hit-area is
            // derived from it, so the button (drawn at the right) could fall outside it.
            // Pin it to the node width.
            const onMouseMove = this.onMouseMove;
            this.onMouseMove = function (e, pos) {
                onMouseMove?.apply(this, arguments);
                const x = btnX(this.size[0]);
                const hover = pos[0] >= x && pos[0] <= x + BTN_W
                    && pos[1] >= widget.y + 2 && pos[1] <= widget.y + 2 + BTN_H;
                if (hover !== widget.hover) {
                    widget.hover = hover;
                    this.setDirtyCanvas(true, true);
                }
            };
            const onMouseLeave = this.onMouseLeave;
            this.onMouseLeave = function () {
                onMouseLeave?.apply(this, arguments);
                if (widget.hover) {
                    widget.hover = false;
                    this.setDirtyCanvas(true, true);
                }
            };
            this.addCustomWidget(spec);
            // ComfyUI wraps the spec in its own object; state and hit-area must live on that one.
            widget = this.widgets[this.widgets.length - 1];
            Object.defineProperty(widget, "width", {
                get: () => node.size[0],
                set: () => {},
                enumerable: true,
                configurable: true,
            });
            this.setSize([Math.max(this.size[0], 300), this.computeSize()[1]]);
        };
    },
});
