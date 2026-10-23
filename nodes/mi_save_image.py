import os
import re
from datetime import datetime

import numpy as np
from aiohttp import web
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import folder_paths
from comfy.cli_args import args
from server import PromptServer

DEFAULT_PREFIX = "%date:MM-dd-hh-mm-ss%"

_DATE_TOKENS = (
    ("yyyy", "%Y"),
    ("yy", "%y"),
    ("MM", "%m"),
    ("dd", "%d"),
    ("hh", "%H"),
    ("mm", "%M"),
    ("ss", "%S"),
)


def format_name(pattern, now=None):
    """Expands %date:<fmt>% tokens (yyyy, yy, MM, dd, hh, mm, ss)."""
    now = now or datetime.now()

    def repl(match):
        fmt = match.group(1)
        for token, strf in _DATE_TOKENS:
            fmt = fmt.replace(token, now.strftime(strf))
        return fmt

    return re.sub(r"%date:([^%]*)%", repl, pattern)


def unique_path(directory, base, ext=".png"):
    path = os.path.join(directory, base + ext)
    n = 1
    while os.path.exists(path):
        path = os.path.join(directory, f"{base}_{n}{ext}")
        n += 1
    return path


class MIsave_image:
    """Saves images to ComfyUI's temp folder; the SAVE button copies them to the output folder."""

    def __init__(self):
        self.temp_dir = folder_paths.get_temp_directory()

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": DEFAULT_PREFIX}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "MI nodes"

    def preview(self, images, filename_prefix=DEFAULT_PREFIX, prompt=None, extra_pnginfo=None):
        os.makedirs(self.temp_dir, exist_ok=True)
        base = os.path.basename(format_name(filename_prefix)) or "image"
        results = []
        for i, image in enumerate(images):
            arr = np.clip(255.0 * image.cpu().numpy(), 0, 255).astype(np.uint8)
            img = Image.fromarray(arr)

            metadata = None
            if not args.disable_metadata:
                metadata = PngInfo()
                if prompt is not None:
                    import json
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    import json
                    for k, v in extra_pnginfo.items():
                        metadata.add_text(k, json.dumps(v))

            name = f"{base}_{i:02d}" if len(images) > 1 else base
            path = unique_path(self.temp_dir, name)
            img.save(path, pnginfo=metadata, compress_level=4)
            results.append({"filename": os.path.basename(path), "subfolder": "", "type": "temp"})

        return {"ui": {"images": results}, "result": (images,)}


@PromptServer.instance.routes.post("/MIsave_image/save")
async def misave_image_save(request):
    """Copies images from the temp folder to the default output folder."""
    import shutil

    data = await request.json()
    prefix = data.get("filename_prefix") or DEFAULT_PREFIX
    items = data.get("images") or []

    temp_dir = os.path.realpath(folder_paths.get_temp_directory())
    out_dir = os.path.realpath(folder_paths.get_output_directory())

    sources = []
    for item in items:
        src = os.path.realpath(os.path.join(temp_dir, item.get("subfolder", ""), item.get("filename", "")))
        if os.path.commonpath([src, temp_dir]) != temp_dir or not os.path.isfile(src):
            return web.json_response({"error": f"Invalid image: {item.get('filename')}"}, status=400)
        sources.append(src)
    if not sources:
        return web.json_response({"error": "No images to save"}, status=400)

    expanded = format_name(prefix).replace("\\", "/")
    sub, base = os.path.split(expanded)
    base = base or "image"
    dest_dir = os.path.realpath(os.path.join(out_dir, sub))
    if os.path.commonpath([dest_dir, out_dir]) != out_dir:
        return web.json_response({"error": "Invalid prefix"}, status=400)
    os.makedirs(dest_dir, exist_ok=True)

    saved = []
    for i, src in enumerate(sources):
        name = f"{base}_{i:02d}" if len(sources) > 1 else base
        dst = unique_path(dest_dir, name, os.path.splitext(src)[1])
        shutil.copy2(src, dst)
        saved.append(os.path.relpath(dst, out_dir).replace("\\", "/"))

    return web.json_response({"saved": saved})


NODE_CLASS_MAPPINGS = {"MIsave_image": MIsave_image}
NODE_DISPLAY_NAME_MAPPINGS = {"MIsave_image": "MI Save Image"}

