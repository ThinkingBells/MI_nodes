"""MI nodes: MI Lora, MI Unet Rate, MI Embedding, MI Compare 3 Images, MI Save Image, MI Reroute Sound and MI Bounding Boxes in one package."""
from .nodes import mi_embedding, mi_lora, mi_reroute_sound, mi_save_image, mi_unet_rate, compare3, mi_bbox

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
for _m in (mi_lora, mi_unet_rate, mi_embedding, compare3, mi_save_image, mi_reroute_sound, mi_bbox):
    NODE_CLASS_MAPPINGS.update(_m.NODE_CLASS_MAPPINGS)
    NODE_DISPLAY_NAME_MAPPINGS.update(_m.NODE_DISPLAY_NAME_MAPPINGS)

# ComfyUI cannot serve the web files of a folder whose name contains a space, so the
# folder must be called "MI_nodes". The badge at the top right of every node is taken
# from RELATIVE_PYTHON_MODULE (set by ComfyUI after this file is imported); this makes
# it read "MI nodes" instead of the folder name.
BADGE = "MI nodes"


class _BadgeMeta(type):
    def __setattr__(cls, name, value):
        if name == "RELATIVE_PYTHON_MODULE":
            value = f"custom_nodes.{BADGE}"
        super().__setattr__(name, value)


for _key, _cls in list(NODE_CLASS_MAPPINGS.items()):
    # same class, only with a metaclass that fixes the badge
    NODE_CLASS_MAPPINGS[_key] = _BadgeMeta(_cls.__name__, (_cls,), {"__module__": _cls.__module__})

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
