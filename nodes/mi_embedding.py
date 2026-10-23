import os
import folder_paths

NONE = "(none)"
MAX_ROWS = 8


def _embedding_list():
    return [NONE] + folder_paths.get_filename_list("embeddings")


class MI_embedding:
    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "enabled": ("BOOLEAN", {"default": True, "label_on": "enabled", "label_off": "disabled"}),
            "position": (["before text", "after text"],),
            # number of visible rows; the js shows/hides the embedding_N / strength_N widgets
            "count": ("INT", {"default": 1, "min": 1, "max": MAX_ROWS}),
        }
        for i in range(1, MAX_ROWS + 1):
            required[f"embedding_{i}"] = (_embedding_list(),)
            required[f"strength_{i}"] = ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.05})
        return {
            "required": required,
            "optional": {
                "text": ("STRING", {"forceInput": True, "default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "run"
    CATEGORY = "MI nodes"

    def run(self, enabled, position, count, text="", **kwargs):
        text = text or ""
        if not enabled:
            return (text,)
        tags = []
        for i in range(1, count + 1):
            name = kwargs.get(f"embedding_{i}", NONE)
            if not name or name == NONE:
                continue
            strength = float(kwargs.get(f"strength_{i}", 1.0))
            name = os.path.splitext(name)[0].replace("\\", "/")
            tags.append(f"embedding:{name}" if strength == 1.0 else f"(embedding:{name}:{strength:g})")
        if not tags:
            return (text,)
        tag = ", ".join(tags)
        if not text.strip():
            return (tag,)
        return (f"{tag}, {text}",) if position == "before text" else (f"{text}, {tag}",)


NODE_CLASS_MAPPINGS = {"MI_embedding": MI_embedding}
NODE_DISPLAY_NAME_MAPPINGS = {"MI_embedding": "MI Embedding"}
