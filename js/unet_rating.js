import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE = "UNETLoaderRated";
const STAR = 18;
const GAP = 4;
const ROW_H = 26;
const MARGIN = 15; // mateix marge lateral que els altres camps del node
const FIELD_GAP = 12; // separació entre el camp de comentaris i les estrelles

let ratings = {};

async function fetchRatings() {
    try {
        const r = await api.fetchApi("/unet_rating/ratings");
        ratings = await r.json();
    } catch (e) {
        console.warn("[UNET Rating] no s'han pogut carregar les valoracions", e);
    }
}

async function saveRating(name, stars) {
    if (stars) ratings[name] = stars;
    else delete ratings[name];
    try {
        await api.fetchApi("/unet_rating/rate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, stars }),
        });
    } catch (e) {
        console.warn("[UNET Rating] error desant la valoració", e);
    }
}

let notes = {};

async function fetchNotes() {
    try {
        const r = await api.fetchApi("/unet_rating/notes");
        notes = await r.json();
    } catch (e) {
        console.warn("[UNET Rating] no s'han pogut carregar les notes", e);
    }
}

async function saveNote(name, note) {
    if (note) notes[name] = note;
    else delete notes[name];
    try {
        await api.fetchApi("/unet_rating/note", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, note }),
        });
    } catch (e) {
        console.warn("[UNET Rating] error desant la nota", e);
    }
}

function starPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r : r * 0.45;
        const x = cx + Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
}

// valoració = 0-3 estrelles
const SLOTS = 3;

const slotX = (i) => i * (STAR + GAP);
const STARS_W = slotX(SLOTS - 1) + STAR;
// disposició de la fila: [ camp de comentaris | estrelles ]
const starsX0 = (width) => width - MARGIN - STARS_W;
const fieldW = (width) => starsX0(width) - FIELD_GAP - MARGIN;

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

const starsText = (n) => "★".repeat(n) + "☆".repeat(SLOTS - n);

// Dibuixa el combo amb les estrelles al final del nom (només mentre pinta).
function decorateComboDraw(widget) {
    for (const key of ["draw", "drawWidget"]) {
        const orig = widget[key];
        if (typeof orig !== "function") continue;
        widget[key] = function (...args) {
            const r = ratings[this.value];
            if (this.__miDecorating || !r) return orig.apply(this, args);
            const real = this.value;
            this.__miDecorating = true;
            // al davant: el nom es trunca per la dreta i les estrelles s'haurien d'amagar
            this.value = `${starsText(r)}  ${real}`;
            try {
                return orig.apply(this, args);
            } finally {
                this.value = real;
                this.__miDecorating = false;
            }
        };
    }
}

// Afegeix les estrelles al final de cada entrada de la llista desplegable.
function decorateMenu(menu) {
    const entries = [...menu.querySelectorAll(".litemenu-entry")].filter((e) => !e.querySelector(".mi-stars"));
    const nameOf = (e) => e.dataset.value ?? e.textContent.trim();
    // només si el menú conté algun model valorat (evita tocar altres menús)
    if (!entries.some((e) => ratings[nameOf(e)])) return;
    for (const entry of entries) {
        const r = ratings[nameOf(entry)] || 0;
        const span = document.createElement("span");
        span.className = "mi-stars";
        span.style.cssText = "margin-right:12px;white-space:nowrap;font-family:monospace;";
        // estrelles omplertes en taronja i buides en granat; sense valoració, espai invisible per alinear els noms
        const on = document.createElement("span");
        on.textContent = "★".repeat(r);
        on.style.color = "#E0702D";
        const off = document.createElement("span");
        off.textContent = "☆".repeat(SLOTS - r);
        off.style.color = "#791718";
        span.append(on, off);
        if (!r) span.style.visibility = "hidden";
        entry.prepend(span);
    }
}

function watchMenus() {
    new MutationObserver(() => {
        document.querySelectorAll(".litecontextmenu").forEach(decorateMenu);
    }).observe(document.body, { childList: true, subtree: true });
}

app.registerExtension({
    name: "UNETRating.Stars",

    async setup() {
        await fetchRatings();
        watchMenus();
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;
            const combo = node.widgets.find((w) => w.name === "unet_name");
            let hover = 0;

            const current = () => ratings[combo.value] || 0;
            decorateComboDraw(combo);

            const widget = {
                name: "rating",
                type: "unet_rating",
                value: 0,
                serialize: false,
                options: { serialize: false },
                computeSize: (width) => [width, ROW_H],
                draw(ctx, _node, _w, y) {
                    // usa sempre l'amplada real del node (el paràmetre pot venir reduït després d'alguns repintats)
                    const width = node.size[0];
                    const cy = y + ROW_H / 2;

                    // camp de comentaris (una línia) a l'esquerra
                    const fw = fieldW(width);
                    ctx.save();
                    roundRect(ctx, MARGIN, y + 1, fw, ROW_H - 2, (ROW_H - 2) / 2);
                    ctx.fillStyle = "#222";
                    ctx.fill();
                    ctx.strokeStyle = hover === "field" ? "#aaa" : "#555";
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.font = "12px sans-serif";
                    ctx.textBaseline = "middle";
                    ctx.textAlign = "left";
                    const note = notes[combo.value] || "";
                    ctx.fillStyle = note ? "#ddd" : "#777";
                    // el text comença a l'esquerra i flueix cap a la dreta; el que no hi cap es retalla a la vora
                    ctx.beginPath();
                    ctx.rect(MARGIN + 10, y, fw - 20, ROW_H);
                    ctx.clip();
                    ctx.fillText(note || "comments", MARGIN + 10, cy);
                    ctx.restore();

                    // estrelles a la dreta (sempre la nota real; el ratolí només ressalta la icona)
                    const shown = current();
                    const x0 = starsX0(width);
                    for (let i = 0; i < SLOTS; i++) {
                        const lit = i < shown;
                        starPath(ctx, x0 + slotX(i) + STAR / 2, cy, STAR / 2);
                        ctx.fillStyle = lit ? "#E0702D" : "#3A3A3A";
                        ctx.fill();
                        ctx.strokeStyle = "#FFFFFF";
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                },
                mouse(event, pos) {
                    const width = node.size[0];
                    const x0 = starsX0(width);
                    let target = 0;
                    for (let i = 0; i < SLOTS; i++) {
                        const sx = x0 + slotX(i);
                        if (pos[0] >= sx - GAP / 2 && pos[0] <= sx + STAR + GAP / 2) target = i + 1;
                    }
                    if (!target && pos[0] >= MARGIN && pos[0] <= MARGIN + fieldW(width)) target = "field";

                    if (event.type === "pointermove" || event.type === "mousemove") {
                        if (target !== hover) {
                            hover = target;
                            node.setDirtyCanvas(true);
                        }
                        return false;
                    }
                    if (event.type === "pointerdown" || event.type === "mousedown") {
                        if (!target) return false;
                        if (target === "field") {
                            const name = combo.value;
                            const done = (value) => {
                                const clean = String(value ?? "").replace(/\s+/g, " ").trim();
                                saveNote(name, clean);
                                node.setDirtyCanvas(true);
                            };
                            const old = notes[name] || "";
                            if (app.canvas?.prompt) app.canvas.prompt("comments", old, done, event);
                            else {
                                const v = window.prompt("comments", old);
                                if (v !== null) done(v);
                            }
                            return true;
                        }
                        // clic a l'última estrella activa = treu-ne una; altrament fixa aquesta nota
                        saveRating(combo.value, target === current() ? target - 1 : target);
                        node.setDirtyCanvas(true);
                        return true;
                    }
                    if (event.type === "pointerleave" || event.type === "mouseleave") {
                        hover = 0;
                        node.setDirtyCanvas(true);
                    }
                    return false;
                },
            };

            node.addCustomWidget(widget);

            // repinta les estrelles quan canvia el model triat
            const cb = combo.callback;
            combo.callback = function () {
                cb?.apply(this, arguments);
                node.setDirtyCanvas(true);
            };

            Promise.all([fetchRatings(), fetchNotes()]).then(() => node.setDirtyCanvas(true));
        };
    },
});
