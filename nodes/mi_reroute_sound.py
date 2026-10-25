import os

from aiohttp import web
from server import PromptServer

SOUNDS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sounds")
NONE = "(none)"


class AnyType(str):
    """Matches every socket type, like a reroute."""

    def __ne__(self, other):
        return False


ANY = AnyType("*")


def _sound_list():
    try:
        names = sorted(f for f in os.listdir(SOUNDS_DIR) if f.lower().endswith(".wav"))
    except OSError:
        names = []
    return [NONE] + names


def _default_sound():
    names = _sound_list()
    return "ding.wav" if "ding.wav" in names else names[-1]


@PromptServer.instance.routes.get("/mi_sound/{name}")
async def get_sound(request):
    name = request.match_info["name"]
    path = os.path.join(SOUNDS_DIR, os.path.basename(name))
    if name != os.path.basename(name) or not name.lower().endswith(".wav") or not os.path.isfile(path):
        return web.Response(status=404)
    return web.FileResponse(path)


class MI_reroute_sound:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (ANY,),
                "sound": (_sound_list(), {"default": _default_sound()}),
            }
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("value",)
    FUNCTION = "run"
    CATEGORY = "MI nodes"

    def run(self, value, sound):
        ui = {"mi_sound": [sound]} if sound and sound != NONE else {}
        return {"ui": ui, "result": (value,)}


NODE_CLASS_MAPPINGS = {"MI_reroute_sound": MI_reroute_sound}
NODE_DISPLAY_NAME_MAPPINGS = {"MI_reroute_sound": "MI Reroute Sound ♪♪♪"}
