import json
import os
import re
import uuid

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

import folder_paths

PREVIEW_LONG_EDGE = 1024
PREVIEW_DIM = 0.25
DEFAULT_RGB = (140, 140, 140)
HEX_RE = re.compile(r"#?([0-9a-fA-F]{6})")


def _clamp01(v):
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return 0.0


def parse_boxes(raw):
    """JSON written by the canvas editor -> list of boxes in fractions (0-1) of the canvas."""
    try:
        data = json.loads(raw) if isinstance(raw, str) and raw.strip() else []
    except ValueError:
        data = []
    boxes = []
    for b in data if isinstance(data, list) else []:
        if not isinstance(b, dict):
            continue
        x, y = _clamp01(b.get("x")), _clamp01(b.get("y"))
        w, h = _clamp01(b.get("w")), _clamp01(b.get("h"))
        w, h = min(w, 1.0 - x), min(h, 1.0 - y)
        if w <= 0 or h <= 0:
            continue
        palette = []
        for c in b.get("palette") or []:
            m = HEX_RE.fullmatch(c.strip()) if isinstance(c, str) else None
            if m:
                palette.append("#" + m.group(1).upper())
        boxes.append({
            "x": x, "y": y, "w": w, "h": h,
            "type": "text" if b.get("type") == "text" else "obj",
            "text": str(b.get("text") or ""),
            "desc": str(b.get("desc") or ""),
            "palette": palette[:5],
        })
    return boxes


def _grid(v):
    return max(0, min(1000, round(v * 1000)))


def to_element(box):
    """Same shape as the core "Create Bounding Boxes" elements: bbox is [ymin, xmin, ymax, xmax] on a 0-1000 grid."""
    el = {"type": box["type"]}
    el["bbox"] = [_grid(box["y"]), _grid(box["x"]), _grid(box["y"] + box["h"]), _grid(box["x"] + box["w"])]
    if box["type"] == "text":
        el["text"] = box["text"]
    el["desc"] = box["desc"]
    if box["palette"]:
        el["color_palette"] = box["palette"]
    return el


def to_pixels(box, width, height):
    return {
        "x": round(box["x"] * width),
        "y": round(box["y"] * height),
        "width": round(box["w"] * width),
        "height": round(box["h"] * height),
    }


def _hex_rgb(value):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def _font(size):
    try:
        return ImageFont.load_default(size)
    except Exception:
        return ImageFont.load_default()


def _wrap(draw, text, font, max_w):
    lines = []
    for para in text.split("\n"):
        line = ""
        for word in para.split():
            test = word if not line else line + " " + word
            if line and draw.textlength(test, font=font) > max_w:
                lines.append(line)
                line = word
            else:
                line = test
        lines.append(line)
    return lines


def render_preview(boxes, width, height, bg=None):
    long_edge = max(width, height) or 1
    scale = min(1.0, PREVIEW_LONG_EDGE / long_edge)
    rw, rh = max(1, round(width * scale)), max(1, round(height * scale))
    if bg is not None:
        base = ImageEnhance.Brightness(bg.convert("RGB").resize((rw, rh), Image.LANCZOS)).enhance(PREVIEW_DIM)
        img = base.convert("RGBA")
    else:
        grey = round(PREVIEW_DIM * 128)
        img = Image.new("RGBA", (rw, rh), (grey, grey, grey, 255))

    overlay = Image.new("RGBA", (rw, rh), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    fs = max(10, round(rh / 64))
    font, tag_font = _font(fs), _font(max(9, fs - 2))

    for i, box in enumerate(boxes):
        r, g, b = _hex_rgb(box["palette"][0]) if box["palette"] else DEFAULT_RGB
        x1, y1 = round(box["x"] * rw), round(box["y"] * rh)
        x2, y2 = round((box["x"] + box["w"]) * rw), round((box["y"] + box["h"]) * rh)
        draw.rectangle([x1, y1, x2, y2], outline=(r, g, b, 255), width=2)

        tag = str(i + 1).zfill(2)
        tw = draw.textlength(tag, font=tag_font)
        draw.rectangle([x1, y1, x1 + tw + 6, y1 + fs + 2], fill=(r, g, b, 255))
        dark = (0.299 * r + 0.587 * g + 0.114 * b) > 140
        draw.text((x1 + 3, y1 + 1), tag, fill=(0, 0, 0, 255) if dark else (255, 255, 255, 255), font=tag_font)

        body = box["desc"]
        if box["type"] == "text" and box["text"]:
            body = '"%s"%s' % (box["text"], " - " + body if body else "")
        if body and (x2 - x1) > 8:
            ty = y1 + fs + 5
            for line in _wrap(draw, body, font, x2 - x1 - 8):
                if ty > y2:
                    break
                draw.text((x1 + 4, ty), line, fill=(255, 255, 255, 255), font=font)
                ty += fs + 2

    composed = Image.alpha_composite(img, overlay).convert("RGB")
    return torch.from_numpy(np.asarray(composed, dtype=np.float32) / 255.0).unsqueeze(0)


def image_to_pil(image):
    arr = (image[0].detach().cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


class MIBoundingBoxes:
    DESCRIPTION = (
        "Draw boxes on a canvas inside the node (classic LiteGraph, no Vue widget). Each box has a type "
        "(object / text), a description, optional text and colours. 'elements' feeds MOSS-Image Layout Prompt, "
        "Build JSON Prompt (Ideogram) and the Flux layout prompt; 'bboxes' is the core BOUNDING_BOX type. "
        "Boxes are numbered in the order of the list: first = background, last = foreground."
    )

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 16, "max": 16384, "step": 16,
                                  "tooltip": "Canvas width and pixel grid of the boxes. Ignored when an image is connected."}),
                "height": ("INT", {"default": 1024, "min": 16, "max": 16384, "step": 16,
                                   "tooltip": "Canvas height and pixel grid of the boxes. Ignored when an image is connected."}),
                "boxes": ("STRING", {"default": "[]", "tooltip": "Internal state of the canvas editor."}),
            },
            "optional": {
                "image": ("IMAGE", {"tooltip": "Optional background for the canvas; its size replaces width/height."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "BOUNDING_BOX", "ARRAY", "INT", "INT")
    RETURN_NAMES = ("preview", "bboxes", "elements", "width", "height")
    FUNCTION = "build"
    OUTPUT_NODE = True
    CATEGORY = "MI nodes"

    def build(self, width, height, boxes, image=None):
        bg = None
        ui = {}
        if image is not None and len(image) > 0:
            bg = image_to_pil(image)
            width, height = bg.size
            ui["mi_bbox_bg"] = [self._save_background(bg)]
        ui["mi_bbox_dims"] = [width, height]

        parsed = parse_boxes(boxes)
        preview = render_preview(parsed, width, height, bg)
        frame = [to_pixels(b, width, height) for b in parsed]
        bboxes = [frame] if frame else []
        elements = [to_element(b) for b in parsed]
        return {"ui": ui, "result": (preview, bboxes, elements, width, height)}

    @staticmethod
    def _save_background(pil):
        scale = min(1.0, PREVIEW_LONG_EDGE / (max(pil.size) or 1))
        small = pil.resize((max(1, round(pil.width * scale)), max(1, round(pil.height * scale))), Image.LANCZOS)
        temp = folder_paths.get_temp_directory()
        name = f"mi_bbox_bg_{uuid.uuid4().hex[:10]}.png"
        small.convert("RGB").save(os.path.join(temp, name), compress_level=1)
        return {"filename": name, "subfolder": "", "type": "temp"}


NODE_CLASS_MAPPINGS = {"MI_bbox": MIBoundingBoxes}
NODE_DISPLAY_NAME_MAPPINGS = {"MI_bbox": "MI Bounding Boxes"}
