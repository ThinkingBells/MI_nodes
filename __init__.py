"""MI nodes: MI_lora, MI_embedding, MI Unet Rate, MiCompare 3 images and MIsave_image in one package."""
from .nodes import mi_embedding, mi_lora, mi_save_image, mi_unet_rate, compare3

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
for _m in (mi_lora, mi_unet_rate, mi_embedding, compare3, mi_save_image):
    NODE_CLASS_MAPPINGS.update(_m.NODE_CLASS_MAPPINGS)
    NODE_DISPLAY_NAME_MAPPINGS.update(_m.NODE_DISPLAY_NAME_MAPPINGS)

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
