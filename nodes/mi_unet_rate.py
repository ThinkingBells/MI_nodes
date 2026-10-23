import json
import os

from . import DATA_DIR
import tempfile
import threading

import folder_paths
from aiohttp import web
from server import PromptServer

import nodes as comfy_nodes

RATINGS_FILE = os.path.join(DATA_DIR, "ratings.json")
_lock = threading.Lock()


def _unet_list():
    names = []
    for folder in ("diffusion_models", "unet"):
        try:
            names += folder_paths.get_filename_list(folder)
        except Exception:
            pass
    return sorted(set(names)) or [NO_MODELS]


NOTES_FILE = os.path.join(DATA_DIR, "notes.json")
MAX_NOTE = 300
NO_MODELS = "(cap model trobat)"


def _load_ratings(path=RATINGS_FILE):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_ratings(data, path=RATINGS_FILE):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


class UNETLoaderRated:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "unet_name": (_unet_list(),),
                "weight_dtype": (["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"],),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "load_unet"
    CATEGORY = "MI nodes"

    def load_unet(self, unet_name, weight_dtype):
        return comfy_nodes.UNETLoader().load_unet(unet_name, weight_dtype)


def _normalize(value):
    """Valor desat -> enter 0-3. Accepta formats d'abans (escala antiga o {"stars": n})."""
    if isinstance(value, dict):
        value = value.get("stars", 0)
    if isinstance(value, int) and not isinstance(value, bool):
        return max(0, min(value, 3))
    return 0


def _normalized_ratings():
    ratings = {k: _normalize(v) for k, v in _load_ratings().items()}
    return {k: v for k, v in ratings.items() if v}


@PromptServer.instance.routes.get("/unet_rating/ratings")
async def get_ratings(request):
    with _lock:
        return web.json_response(_normalized_ratings())


@PromptServer.instance.routes.post("/unet_rating/rate")
async def set_rating(request):
    body = await request.json()
    name = body.get("name")
    stars = body.get("stars")
    if (
        not isinstance(name, str)
        or not isinstance(stars, int)
        or isinstance(stars, bool)
        or not 0 <= stars <= 3
        or name == NO_MODELS
    ):
        return web.json_response({"error": "dades invalides"}, status=400)
    with _lock:
        data = _normalized_ratings()
        if stars == 0:
            data.pop(name, None)
        else:
            data[name] = stars
        _save_ratings(data)
    return web.json_response({"name": name, "stars": stars})


@PromptServer.instance.routes.get("/unet_rating/notes")
async def get_notes(request):
    with _lock:
        return web.json_response(_load_ratings(NOTES_FILE))


@PromptServer.instance.routes.post("/unet_rating/note")
async def set_note(request):
    body = await request.json()
    name = body.get("name")
    note = body.get("note")
    if not isinstance(name, str) or not isinstance(note, str) or name == NO_MODELS:
        return web.json_response({"error": "dades invalides"}, status=400)
    note = " ".join(note.split())[:MAX_NOTE]
    with _lock:
        data = _load_ratings(NOTES_FILE)
        if note:
            data[name] = note
        else:
            data.pop(name, None)
        _save_ratings(data, NOTES_FILE)
    return web.json_response({"name": name, "note": note})


NODE_CLASS_MAPPINGS = {"UNETLoaderRated": UNETLoaderRated}
NODE_DISPLAY_NAME_MAPPINGS = {"UNETLoaderRated": "MI Unet Rate"}

