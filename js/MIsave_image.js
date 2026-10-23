import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MARGIN = 15;
const BTN_W = 130;
const BTN_H = 30;
const ROW_H = BTN_H + 4;
const btnX = (nodeWidth) => nodeWidth - MARGIN - BTN_W;

app.registerExtension({
    name: "MIsave_image.SaveButton",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "MIsave_image") return;

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            this._misaveImages = message?.images ?? [];
        };

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);

            const node = this;
            let widget; // the widget instance ComfyUI actually keeps (set below)
            const flash = (text) => {
                widget.label = text;
                node.setDirtyCanvas(true, true);
                setTimeout(() => { widget.label = "SAVE"; node.setDirtyCanvas(true, true); }, 2000);
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
                        body: JSON.stringify({ images, filename_prefix: prefix }),
                    });
                    const data = await res.json();
                    flash(res.ok ? "SAVED" : "ERROR");
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
                    ctx.fillStyle = this.pressed ? "#F66844" : this.hover ? "#F66844" : "#3a3a3a";
                    ctx.strokeStyle = "#666";
                    ctx.beginPath();
                    ctx.roundRect(x, y + 2, BTN_W, h, 6);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = this.pressed || this.hover ? "#000" : "#ddd";
                    ctx.font = "bold 12px sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(this.label, x + BTN_W / 2, y + 2 + h / 2);
                    ctx.restore();
                },
                mouse(event, pos, node) {
                    const x = btnX(node.size[0]);
                    if ((event.type === "pointerdown" || event.type === "mousedown")
                        && pos[0] >= x && pos[0] <= x + BTN_W) {
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
