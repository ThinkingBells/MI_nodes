import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Canvas-drawn box editor: only LiteGraph widget draw/mouse hooks, no DOM and no Vue widget,
// so it works in the classic LiteGraph canvas.
const NODE = "MI_bbox";
const ACCENT = "#e0702d";
const COLORS = ["#e0702d", "#3ec3d1", "#8bd63a", "#d14fd1", "#e8c52e", "#4f8ae0", "#e05a5a", "#7a6be0"];
const PAD = 10;
const BTN_H = 20;
const GAP = 4;
const TOOLBAR = BTN_H + 6;
const LINE = 13;
const CELL_FONT = "11px sans-serif";
const measureCtx = document.createElement("canvas").getContext("2d");
const HANDLE = 5;
const MIN_FRAC = 0.01;
const MIN_WIDTH = 360;
const BUTTONS = [["back", "Back"], ["front", "Front"], ["del", "Delete"]];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round5 = (v) => Math.round(v * 1e5) / 1e5;

function widget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

// shown name of the image input; the internal name stays "image" so saved workflows keep working
function labelInputs(node) {
  const input = node.inputs?.find((i) => i.name === "image");
  if (input) input.label = "background image";
}

function state(node) {
  return (node._mibb ??= { boxes: [], sel: -1, bg: null, dims: null, drag: null });
}

function load(node) {
  const st = state(node);
  let data = [];
  try { data = JSON.parse(widget(node, "boxes")?.value || "[]"); } catch (e) { /* keep empty */ }
  st.boxes = (Array.isArray(data) ? data : []).map((b) => ({
    x: clamp01(+b.x || 0), y: clamp01(+b.y || 0), w: clamp01(+b.w || 0), h: clamp01(+b.h || 0),
    type: b.type === "text" ? "text" : "obj",
    text: b.text || "", desc: b.desc || "",
    palette: Array.isArray(b.palette) ? b.palette.filter((c) => typeof c === "string") : [],
  }));
  st.sel = Math.min(st.sel, st.boxes.length - 1);
  st.rowsH = bottomH(node);
}

function colWidths(node) {
  const totalW = node.size[0] - 2 * PAD;
  const tagW = 24;
  const rest = totalW - tagW - 2 * GAP;
  const textW = rest * 0.3;
  return { tagW, textW, descW: rest - textW };
}

// rows grow with the wrapped text of their cells
function rowLayout(node) {
  const { textW, descW } = colWidths(node);
  measureCtx.font = CELL_FONT;
  return state(node).boxes.map((b) => {
    const text = wrapText(measureCtx, b.text, textW - 12);
    const desc = wrapText(measureCtx, b.desc, descW - 12);
    const lines = Math.max(1, text.length, desc.length);
    return { text, desc, h: Math.max(BTN_H, lines * LINE + 8) };
  });
}

function bottomH(node) {
  const rows = rowLayout(node);
  return rows.length ? rows.reduce((t, r) => t + r.h + GAP, 0) + 2 : 0;
}

// grow or shrink the node when the rows change height
function syncRows(node) {
  const st = state(node);
  const h = bottomH(node);
  const delta = h - (st.rowsH ?? 0);
  st.rowsH = h;
  if (delta && node.widgets) node.setSize([node.size[0], Math.max(node.size[1] + delta, 60)]);
}

function save(node) {
  const st = state(node);
  const w = widget(node, "boxes");
  if (!w) return;
  w.value = JSON.stringify(st.boxes.map((b) => ({
    x: round5(b.x), y: round5(b.y), w: round5(b.w), h: round5(b.h),
    type: b.type, text: b.text, desc: b.desc, palette: b.palette,
  })));
  syncRows(node);
  node.setDirtyCanvas(true, true);
}

// Value an upstream node currently shows for the output feeding this input (e.g. a width widget),
// so the canvas follows it before the workflow runs.
function upstreamValue(node, name) {
  const input = node.inputs?.find((i) => i.name === name);
  if (input?.link == null) return null;
  const g = node.graph ?? app.graph;
  // links is a plain object in older frontends and a Map in newer ones
  const link = g?.getLink?.(input.link) ?? (g?.links instanceof Map ? g.links.get(input.link) : g?.links?.[input.link]);
  const origin = link && g.getNodeById(link.origin_id);
  const out = origin?.outputs?.[link.origin_slot];
  const v = out && origin.widgets?.find((w) => w.name === out.name)?.value;
  return typeof v === "number" && v > 0 ? v : null;
}

function canvasDims(node) {
  const st = state(node);
  const imageLinked = node.inputs?.find((i) => i.name === "image")?.link != null;
  if (imageLinked && st.dims) return st.dims;
  const dim = (name, k) => {
    const linked = node.inputs?.find((i) => i.name === name)?.link != null;
    if (!linked) return widget(node, name)?.value || 1024;
    return upstreamValue(node, name) ?? st.dims?.[k] ?? widget(node, name)?.value ?? 1024;
  };
  return [dim("width", 0), dim("height", 1)];
}

function aspect(node) {
  const [w, h] = canvasDims(node);
  return Math.max(0.25, Math.min(2.5, h / w));
}

// Area where the boxes are drawn, in node-local coordinates (aligned left/top, kept in aspect).
function area(node, cw) {
  const availW = node.size[0] - 2 * PAD;
  const top = (cw.last_y ?? 0) + TOOLBAR;
  const availH = Math.max(60, node.size[1] - top - bottomH(node) - PAD);
  let w = availW, h = w * aspect(node);
  if (h > availH) { h = availH; w = h / aspect(node); }
  return { x: PAD + (availW - w) / 2, y: top, w, h };
}

function fit(node) {
  // resize to the canvas aspect ratio
  const w = Math.max(node.size[0], MIN_WIDTH);
  node.setSize([w, node.computeSize([w, 0])[1]]);
  node.setDirtyCanvas(true, true);
}

function boxColor(b, i) {
  return b.palette?.[0] || COLORS[i % COLORS.length];
}

function buttonRects(node, cw) {
  const rects = [];
  const totalW = node.size[0] - 2 * PAD;
  const bw = (totalW - GAP * (BUTTONS.length - 1)) / BUTTONS.length;
  BUTTONS.forEach(([id, label], c) => {
    rects.push({ id, label, x: PAD + c * (bw + GAP), y: (cw.last_y ?? 0) + 2, w: bw, h: BTN_H });
  });
  // one row per box, pinned to the bottom of the node: type switch, text, description
  const { tagW, textW, descW } = colWidths(node);
  const layout = rowLayout(node);
  let y = node.size[1] - bottomH(node) + 2;
  layout.forEach((row, i) => {
    let x = PAD;
    rects.push({ id: "tag", idx: i, x, y, w: tagW, h: row.h }); x += tagW + GAP;
    rects.push({ id: "text", idx: i, x, y, w: textW, h: row.h, lines: row.text }); x += textW + GAP;
    rects.push({ id: "desc", idx: i, x, y, w: descW, h: row.h, lines: row.desc });
    y += row.h + GAP;
  });
  return rects;
}

const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + " " + word : word;
      if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = word; } else line = test;
      // a single word wider than the box: break it by characters
      while (ctx.measureText(line).width > maxW && line.length > 1) {
        let n = line.length - 1;
        while (n > 1 && ctx.measureText(line.slice(0, n)).width > maxW) n--;
        lines.push(line.slice(0, n));
        line = line.slice(n);
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawWidget(ctx, node, cw, width, y) {
  cw.last_y = y;
  const st = state(node);
  const sel = st.boxes[st.sel];

  // toolbar
  ctx.save();
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const b of buttonRects(node, cw)) {
    const row = b.idx !== undefined;
    const bx = row ? st.boxes[b.idx] : sel;
    const off = row ? false : (b.id === "clear" ? !st.boxes.length : !sel);
    if (b.id === "tag") {
      ctx.fillStyle = boxColor(bx, b.idx);
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "#000";
      ctx.fillText(String(b.idx + 1).padStart(2, "0"), b.x + b.w / 2, b.y + b.h / 2 + 1);
      continue;
    }
    ctx.fillStyle = "#2a2c2e";
    const editing = st.edit && st.edit.idx === b.idx && st.edit.field === b.id;
    ctx.strokeStyle = editing ? "#fff" : (row && b.idx === st.sel ? ACCENT : (off ? "#333" : "#555"));
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(b.x, b.y, b.w, b.h, 4) : ctx.rect(b.x, b.y, b.w, b.h);
    ctx.fill();
    ctx.stroke();
    if (b.id === "text" || b.id === "desc") {
      const value = b.id === "text" ? bx.text : bx.desc;
      ctx.textAlign = "left";
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x + 4, b.y, b.w - 8, b.h);
      ctx.clip();
      ctx.fillStyle = value ? "#ddd" : "#666";
      const lines = value ? b.lines : [b.id === "text" ? "text..." : "description..."];
      lines.forEach((line, k) => ctx.fillText(line, b.x + 6, b.y + 4 + k * LINE + LINE / 2));
      if (st.edit && st.edit.idx === b.idx && st.edit.field === b.id) {
        const prefix = st.edit.ta.value.slice(0, st.edit.ta.selectionStart);
        const pl = wrapText(ctx, prefix, b.w - 12);
        const last = pl[pl.length - 1] || "";
        const trailing = prefix.length - prefix.trimEnd().length;
        const cx = b.x + 6 + ctx.measureText(last).width + (prefix.endsWith("\n") ? 0 : trailing * ctx.measureText(" ").width);
        ctx.fillStyle = "#fff";
        ctx.fillRect(Math.min(cx, b.x + b.w - 5), b.y + 4 + (pl.length - 1) * LINE, 1, LINE);
      }
      ctx.restore();
      ctx.textAlign = "center";
      continue;
    }
    ctx.fillStyle = off ? "#666" : "#ddd";
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
  }
  ctx.restore();

  // canvas
  const a = area(node, cw);
  ctx.save();
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(a.x, a.y, a.w, a.h);
  if (st.bg?.complete && st.bg.naturalWidth && node.inputs?.find((i) => i.name === "image")?.link != null) {
    ctx.drawImage(st.bg, a.x, a.y, a.w, a.h);
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(a.x, a.y, a.w, a.h);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    ctx.moveTo(a.x + (a.w * i) / 4, a.y); ctx.lineTo(a.x + (a.w * i) / 4, a.y + a.h);
    ctx.moveTo(a.x, a.y + (a.h * i) / 4); ctx.lineTo(a.x + a.w, a.y + (a.h * i) / 4);
  }
  ctx.stroke();
  ctx.strokeStyle = "#444";
  ctx.strokeRect(a.x, a.y, a.w, a.h);

  const [W, H] = canvasDims(node);
  // the size can change upstream without this node running: resize the node to the new aspect
  const key = `${W}x${H}`;
  if (st.sizeKey !== key) {
    st.sizeKey = key;
    setTimeout(() => fit(node), 0);
  }
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#777";
  ctx.fillText(`${W} x ${H}`, a.x + a.w - 4, a.y + a.h - 3);

  if (!st.boxes.length) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#666";
    ctx.fillText("Drag on the canvas to draw a box", a.x + a.w / 2, a.y + a.h / 2);
  }

  ctx.textBaseline = "top";
  st.boxes.forEach((b, i) => {
    const col = boxColor(b, i);
    const x = a.x + b.x * a.w, yy = a.y + b.y * a.h, w = b.w * a.w, h = b.h * a.h;
    ctx.fillStyle = col + "22";
    ctx.fillRect(x, yy, w, h);
    ctx.strokeStyle = col;
    ctx.lineWidth = i === st.sel ? 2.5 : 1.5;
    ctx.strokeRect(x, yy, w, h);

    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    const tag = String(i + 1).padStart(2, "0");
    const tw = ctx.measureText(tag).width + 6;
    ctx.fillStyle = col;
    ctx.fillRect(x, yy, tw, 13);
    ctx.fillStyle = "#000";
    ctx.fillText(tag, x + 3, yy + 2);

    let body = b.desc;
    if (b.type === "text" && b.text) body = `"${b.text}"${body ? " - " + body : ""}`;
    if (body && w > 24) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, yy, w, h);
      ctx.clip();
      ctx.fillStyle = "#fff";
      let ty = yy + 16;
      for (const line of wrapText(ctx, body, w - 8)) {
        if (ty > yy + h) break;
        ctx.fillText(line, x + 4, ty);
        ty += 12;
      }
      ctx.restore();
    }
    if (i === st.sel) {
      ctx.fillStyle = "#fff";
      for (const [cx, cy] of [[x, yy], [x + w, yy], [x, yy + h], [x + w, yy + h]]) {
        ctx.fillRect(cx - HANDLE / 2, cy - HANDLE / 2, HANDLE, HANDLE);
      }
    }
  });
  ctx.restore();
}

function promptValue(title, value, cb, event) {
  try {
    app.canvas.prompt(title, value, cb, event);
  } catch (e) {
    const v = window.prompt(title, value);
    if (v !== null) cb(v);
  }
}

// Inline editing: a hidden <textarea> takes the keyboard (typing, paste, IME, caret keys) and the
// canvas cell mirrors its content, so no popup is needed.
function endEdit(node, ta) {
  const st = state(node);
  if (!st.edit || (ta && st.edit.ta !== ta)) return;
  st.edit.ta.remove();
  st.edit = null;
  save(node);
}

function startEdit(node, idx, field) {
  const st = state(node);
  const b = st.boxes[idx];
  if (!b) return;
  if (st.edit) endEdit(node);
  st.sel = idx;
  const ta = document.createElement("textarea");
  ta.value = b[field];
  ta.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(ta);
  st.edit = { idx, field, ta };
  const redraw = () => node.setDirtyCanvas(true, true);
  ta.addEventListener("input", () => {
    b[field] = ta.value;
    if (field === "text") b.type = ta.value.trim() ? "text" : "obj";
    save(node);
  });
  ta.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") { e.preventDefault(); ta.blur(); }
    e.stopPropagation();
  });
  ta.addEventListener("keyup", redraw);
  ta.addEventListener("select", redraw);
  ta.addEventListener("blur", () => endEdit(node, ta));
  // the canvas takes focus on mousedown: focus once the click is over
  const focus = () => setTimeout(() => {
    if (st.edit?.ta !== ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    redraw();
  }, 0);
  window.addEventListener("pointerup", focus, { once: true, capture: true });
  redraw();
}

function runButton(node, id, event, idx) {
  const st = state(node);
  if (idx !== undefined) st.sel = idx;
  const b = st.boxes[st.sel];
  const done = () => { save(node); };
  switch (id) {
    case "desc":
    case "text":
      if (b) startEdit(node, st.sel, id);
      break;
    case "color":
      if (b) {
        promptValue("Colours, hex separated by commas (up to 5, empty = none)", b.palette.join(", "), (v) => {
          b.palette = (String(v).match(/#?[0-9a-fA-F]{6}/g) || []).slice(0, 5).map((c) => "#" + c.replace("#", "").toUpperCase());
          done();
        }, event);
      }
      break;
    case "back":
      if (b && st.sel > 0) {
        [st.boxes[st.sel - 1], st.boxes[st.sel]] = [st.boxes[st.sel], st.boxes[st.sel - 1]];
        st.sel--; done();
      }
      break;
    case "front":
      if (b && st.sel < st.boxes.length - 1) {
        [st.boxes[st.sel + 1], st.boxes[st.sel]] = [st.boxes[st.sel], st.boxes[st.sel + 1]];
        st.sel++; done();
      }
      break;
    case "del":
      if (b) { st.boxes.splice(st.sel, 1); st.sel = Math.min(st.sel, st.boxes.length - 1); done(); }
      break;
    case "clear":
      st.boxes = []; st.sel = -1; done();
      break;
  }
  node.setDirtyCanvas(true, true);
}

function setRect(b, ax, ay, px, py) {
  b.x = Math.min(ax, px); b.y = Math.min(ay, py);
  b.w = Math.abs(px - ax); b.h = Math.abs(py - ay);
}

function startDrag(node, cw, e, fx, fy) {
  const st = state(node);
  const a = area(node, cw);

  // handles of the selected box first
  const sel = st.boxes[st.sel];
  if (sel) {
    const corners = [[sel.x, sel.y], [sel.x + sel.w, sel.y], [sel.x, sel.y + sel.h], [sel.x + sel.w, sel.y + sel.h]];
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = corners[i];
      if (Math.abs(cx * a.w - fx * a.w) <= HANDLE + 3 && Math.abs(cy * a.h - fy * a.h) <= HANDLE + 3) {
        const [ox, oy] = corners[3 - i];
        return { mode: "corner", box: sel, ax: ox, ay: oy };
      }
    }
  }
  for (let i = st.boxes.length - 1; i >= 0; i--) {
    const b = st.boxes[i];
    if (fx >= b.x && fx <= b.x + b.w && fy >= b.y && fy <= b.y + b.h) {
      st.sel = i;
      return { mode: "move", box: b, dx: fx - b.x, dy: fy - b.y };
    }
  }
  return { mode: "new", ax: fx, ay: fy, box: null };
}

function onMouse(node, cw, event, pos) {
  const type = event.type || "";
  if (!/down$/.test(type) || (event.button ?? 0) !== 0) return false;
  const st = state(node);
  const [mx, my] = pos;

  for (const b of buttonRects(node, cw)) {
    if (inside(b, mx, my)) { if (b.id !== "tag") runButton(node, b.id, event, b.idx); else state(node).sel = b.idx; node.setDirtyCanvas(true, true); return true; }
  }
  const a = area(node, cw);
  if (!inside(a, mx, my)) return false;

  const fx = clamp01((mx - a.x) / a.w), fy = clamp01((my - a.y) / a.h);
  st.drag = startDrag(node, cw, event, fx, fy);
  st.drag.moved = false;

  const move = (ev) => {
    const p = app.canvas.convertEventToCanvasOffset(ev);
    const ux = clamp01((p[0] - node.pos[0] - a.x) / a.w), uy = clamp01((p[1] - node.pos[1] - a.y) / a.h);
    const d = st.drag;
    if (!d) return;
    if (Math.abs(ux - fx) * a.w > 2 || Math.abs(uy - fy) * a.h > 2) d.moved = true;
    if (d.mode === "move") {
      d.box.x = Math.max(0, Math.min(1 - d.box.w, ux - d.dx));
      d.box.y = Math.max(0, Math.min(1 - d.box.h, uy - d.dy));
    } else if (d.mode === "corner") {
      setRect(d.box, d.ax, d.ay, ux, uy);
    } else if (d.moved) {
      if (!d.box) {
        d.box = { x: d.ax, y: d.ay, w: 0, h: 0, type: "obj", text: "", desc: "", palette: [] };
        st.boxes.push(d.box);
        st.sel = st.boxes.length - 1;
      }
      setRect(d.box, d.ax, d.ay, ux, uy);
    }
    node.setDirtyCanvas(true, true);
  };
  const up = () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    const d = st.drag;
    st.drag = null;
    if (d) {
      if (d.mode === "new" && !d.moved) st.sel = -1;
      const i = st.boxes.findIndex((b) => b.w < MIN_FRAC || b.h < MIN_FRAC);
      if (i >= 0) {
        st.boxes.splice(i, 1);
        st.sel = Math.min(st.sel, st.boxes.length - 1);
      }
    }
    save(node);
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  node.setDirtyCanvas(true, true);
  return true;
}

app.registerExtension({
  name: "MI.bbox",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      const node = this;
      state(node);

      const boxes = widget(node, "boxes");
      if (boxes) {
        boxes.type = "hidden";
        boxes.hidden = true;
        boxes.computeSize = () => [0, -4];
        boxes.draw = () => {};
      }

      const cw = node.addWidget("custom", "canvas", null, () => {}, { serialize: false });
      cw.serialize = false;
      cw.computeSize = (width) => [width ?? node.size[0], TOOLBAR + Math.round(((width ?? node.size[0]) - 2 * PAD) * aspect(node)) + PAD + bottomH(node)];
      cw.draw = function (ctx, n, width, y) { drawWidget(ctx, node, cw, width, y); };
      cw.mouse = function (event, pos) { return onMouse(node, cw, event, pos); };
      // rows are pinned to the bottom of the node and may lie outside the widget's own height
      // (node taller than its minimum), where LiteGraph would never call the widget: take clicks here
      const prevDown = node.onMouseDown;
      node.onMouseDown = function (event, pos) {
        if (onMouse(node, cw, event, pos)) return true;
        return prevDown?.apply(this, arguments);
      };

      for (const name of ["width", "height"]) {
        const w = widget(node, name);
        const cb = w?.callback;
        if (w) w.callback = function () { cb?.apply(this, arguments); fit(node); };
      }

      // Delete / Backspace removes the selected box instead of the node
      node._mibbKey = (e) => {
        if (e.key !== "Delete" && e.key !== "Backspace") return;
        const st = state(node);
        if (st.edit || st.sel < 0 || !st.boxes[st.sel]) return;
        if (!app.canvas?.selected_nodes?.[node.id]) return;
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        runButton(node, "del", e);
      };
      window.addEventListener("keydown", node._mibbKey, true);

      labelInputs(node);
      load(node);
      fit(node);
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      onRemoved?.apply(this, arguments);
      if (this._mibb?.edit) endEdit(this);
      if (this._mibbKey) window.removeEventListener("keydown", this._mibbKey, true);
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      onConfigure?.apply(this, arguments);
      labelInputs(this);
      load(this);
      this.setDirtyCanvas(true, true);
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      const st = state(this);
      const dims = message?.mi_bbox_dims;
      if (Array.isArray(dims) && dims.length === 2) st.dims = [dims[0], dims[1]];
      const bg = message?.mi_bbox_bg?.[0];
      if (bg) {
        const img = new Image();
        img.onload = () => this.setDirtyCanvas(true, true);
        img.src = api.apiURL(`/view?filename=${encodeURIComponent(bg.filename)}&type=${bg.type}&subfolder=${encodeURIComponent(bg.subfolder || "")}`);
        st.bg = img;
      } else {
        st.bg = null;
      }
      fit(this);
    };

    // keep the aspect ratio in step when an image is plugged in / out
    const onConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      onConnectionsChange?.apply(this, arguments);
      if (this._mibb) fit(this);
    };
  },
});
