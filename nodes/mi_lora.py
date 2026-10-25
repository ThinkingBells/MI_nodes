import asyncio
import hashlib
import json
import os
import urllib.error
import urllib.request

from . import DATA_DIR

import comfy.sd
import comfy.utils
import folder_paths
from server import PromptServer
from aiohttp import web

NONE = "(none)"
MAX_ROWS = 8
TRIGGERS_FILE = os.path.join(DATA_DIR, "triggers.json")


def _load_triggers():
    try:
        with open(TRIGGERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_triggers(data):
    with open(TRIGGERS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)


def _set_trigger(lora, words):
    data = _load_triggers()
    words = (words or "").strip()[:1000]
    if words:
        data[lora] = words
    else:
        data.pop(lora, None)
    _save_triggers(data)


@PromptServer.instance.routes.get("/mi_lora/triggers")
async def get_triggers(request):
    return web.json_response(_load_triggers())


@PromptServer.instance.routes.post("/mi_lora/triggers")
async def post_triggers(request):
    body = await request.json()
    lora = body.get("lora")
    if not isinstance(lora, str) or not lora or lora == NONE:
        return web.json_response({"ok": False}, status=400)
    _set_trigger(lora, body.get("triggers", ""))
    return web.json_response({"ok": True})


HASHES_FILE = os.path.join(DATA_DIR, "hashes.json")
CIVITAI_API = "https://civitai.com/api/v1/model-versions/by-hash/"


def _sha256(path):
    """SHA256 of a file, cached by path + size + mtime."""
    st = os.stat(path)
    key = f"{st.st_size}:{int(st.st_mtime)}"
    try:
        with open(HASHES_FILE, "r", encoding="utf-8") as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}
    entry = cache.get(path)
    if isinstance(entry, dict) and entry.get("key") == key:
        return entry["sha256"]
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    digest = h.hexdigest()
    cache[path] = {"key": key, "sha256": digest}
    with open(HASHES_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)
    return digest


def _civitai_lookup(path):
    digest = _sha256(path)
    req = urllib.request.Request(CIVITAI_API + digest, headers={"User-Agent": "MI-nodes/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"found": False}
        raise
    model = data.get("model") or {}
    return {
        "found": True,
        "model": model.get("name", ""),
        "version": data.get("name", ""),
        "base": data.get("baseModel", ""),
        "words": [w.strip() for w in (data.get("trainedWords") or []) if isinstance(w, str) and w.strip()],
        "url": f"https://civitai.com/models/{data.get('modelId')}?modelVersionId={data.get('id')}",
    }


@PromptServer.instance.routes.get("/mi_lora/civitai")
async def get_civitai(request):
    """Looks a LoRA up on Civitai by file hash (only the hash leaves this machine)."""
    name = request.query.get("lora", "")
    path = folder_paths.get_full_path("loras", name) if name and name != NONE else None
    if not path:
        return web.json_response({"error": "LoRA not found"}, status=400)
    try:
        result = await asyncio.get_running_loop().run_in_executor(None, _civitai_lookup, path)
    except Exception as e:  # network down, API error, unreadable file...
        return web.json_response({"error": f"{type(e).__name__}: {e}"}, status=502)
    return web.json_response(result)


def _lora_list():
    return [NONE] + folder_paths.get_filename_list("loras")


class MI_lora:
    def __init__(self):
        self.loaded = {}

    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "model": ("MODEL",),
            "clip": ("CLIP",),
            # number of visible rows; the js shows/hides the per-row widgets
            "count": ("INT", {"default": 1, "min": 1, "max": MAX_ROWS}),
        }
        for i in range(1, MAX_ROWS + 1):
            required[f"on_{i}"] = ("BOOLEAN", {"default": True, "label_on": "on", "label_off": "off"})
            required[f"lora_{i}"] = (_lora_list(),)
            required[f"strength_{i}"] = ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.05})
            required[f"triggers_{i}"] = ("STRING", {"default": ""})
        return {
            "required": required,
            "optional": {
                "text": ("STRING", {"forceInput": True, "default": ""}),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("model", "clip", "text")
    FUNCTION = "run"
    CATEGORY = "MI nodes"

    def _load(self, name):
        path = folder_paths.get_full_path_or_raise("loras", name)
        if path not in self.loaded:
            self.loaded = {path: comfy.utils.load_torch_file(path, safe_load=True)}
        return self.loaded[path]

    def run(self, model, clip, count, text="", **kwargs):
        text = text or ""

        parts = []
        for i in range(1, count + 1):
            name = kwargs.get(f"lora_{i}", NONE)
            if not name or name == NONE:
                continue
            if not kwargs.get(f"on_{i}", True):
                # row switched off: no LoRA and no trigger words (the saved ones are kept)
                continue
            strength = float(kwargs.get(f"strength_{i}", 1.0))
            if strength != 0:
                model, clip = comfy.sd.load_lora_for_models(model, clip, self._load(name), strength, strength)
            trig = (kwargs.get(f"triggers_{i}") or "").strip().strip(",").strip()
            if trig:
                # keep the saved list in sync with what the node actually used
                if _load_triggers().get(name) != trig:
                    _set_trigger(name, trig)

            if trig:
                parts.append(trig)

        extra = ", ".join(parts)
        # the incoming text may already end with a comma ("1girl,")
        base = text.strip().rstrip(",").rstrip()
        if not extra:
            out = text
        elif not base:
            out = extra
        else:
            out = f"{base}, {extra}"
        return (model, clip, out)


NODE_CLASS_MAPPINGS = {"MI_lora": MI_lora}
NODE_DISPLAY_NAME_MAPPINGS = {"MI_lora": "MI Lora"}
