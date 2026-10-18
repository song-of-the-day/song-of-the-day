"""Profile themes: option loading, strict validation and lenient normalization.

The options file (``shared/theme-options.json``, or ``THEME_OPTIONS_PATH``) is loaded once
per process and checked as a whole: every preset must itself be a valid theme. Two entry
points use it:

* :class:`ThemeIn` validates theme updates strictly (``PATCH /api/profile``).
* :func:`normalize_theme` turns whatever is stored in ``users.theme`` into a complete,
  valid theme, so old rows keep rendering after options change.
"""

from __future__ import annotations

import copy
import json
import os
import re
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from functools import cache
from pathlib import Path
from types import MappingProxyType
from typing import Annotated, Any, Final, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    ValidationInfo,
    field_validator,
)
from pydantic_core import PydanticCustomError

from sotd.schemas.common import ApiModel

THEME_OPTIONS_ENV: Final = "THEME_OPTIONS_PATH"
#: Default options path; valid only in a source checkout (images set THEME_OPTIONS_PATH).
DEFAULT_THEME_OPTIONS_PATH: Final = (
    Path(__file__).resolve().parents[3] / "shared" / "theme-options.json"
)
CUSTOM_PRESET: Final = "custom"
#: Database default of ``annotations.color``; the options file must define it.
DEFAULT_NOTE_COLOR: Final = "yellow"
COLOR_NAMES: Final = ("background", "surface", "text", "accent", "border")
FONT_ROLES: Final = ("heading", "body")

_HEX_COLOR: Final = re.compile(r"#[0-9A-Fa-f]{6}")
_OPTIONS_CONTEXT_KEY: Final = "sotd.theme_options"


class ThemeOptionsError(ValueError):
    """The theme options file is missing, unreadable or inconsistent."""


@dataclass(frozen=True, slots=True)
class ThemeOptions:
    """The validated contents of the theme options file.

    Attributes:
        default_preset: Key of the preset used for new and unrecognized themes.
        fonts: Allowed ``fonts.heading`` / ``fonts.body`` keys.
        patterns: Allowed ``background.pattern`` keys.
        image_fits: Allowed ``background.image_fit`` keys.
        card_styles: Allowed ``card_style`` keys.
        default_views: Allowed ``default_view`` keys.
        note_colors: Allowed annotation ``color`` keys.
        presets: Complete theme of each preset, keyed by preset key. Read-only; use
            :meth:`preset_theme` for a copy.
    """

    default_preset: str
    fonts: frozenset[str]
    patterns: frozenset[str]
    image_fits: frozenset[str]
    card_styles: frozenset[str]
    default_views: frozenset[str]
    note_colors: frozenset[str]
    presets: Mapping[str, Mapping[str, Any]]

    def preset_theme(self, key: str) -> dict[str, Any]:
        """Return a deep, mutable copy of a preset's theme."""
        theme: dict[str, Any] = copy.deepcopy(dict(self.presets[key]))
        return theme


# --- Strict validation -----------------------------------------------------------------


def _options_for(info: ValidationInfo) -> ThemeOptions:
    context = info.context
    if isinstance(context, Mapping):
        options = context.get(_OPTIONS_CONTEXT_KEY)
        if isinstance(options, ThemeOptions):
            return options
    return get_theme_options()


def _require_choice(value: str, choices: frozenset[str]) -> str:
    if value not in choices:
        raise PydanticCustomError(
            "invalid_choice", "Must be one of: {choices}.", {"choices": ", ".join(sorted(choices))}
        )
    return value


def _hex_color(value: str) -> str:
    if _HEX_COLOR.fullmatch(value) is None:
        raise PydanticCustomError("invalid_color", "Must be a #RRGGBB color.")
    return value.upper()


HexColor = Annotated[str, AfterValidator(_hex_color)]


class ThemeColorsIn(ApiModel):
    """The five theme colors, stored upper-case."""

    background: HexColor
    surface: HexColor
    text: HexColor
    accent: HexColor
    border: HexColor


class ThemeFontsIn(ApiModel):
    """Heading and body font keys."""

    heading: str
    body: str

    @field_validator("heading", "body")
    @classmethod
    def _known_font(cls, value: str, info: ValidationInfo) -> str:
        return _require_choice(value, _options_for(info).fonts)


class ThemeBackgroundIn(ApiModel):
    """Background pattern, optional uploaded image and how the image is fitted."""

    pattern: str
    image_upload_id: uuid.UUID | None
    image_fit: str

    @field_validator("pattern")
    @classmethod
    def _known_pattern(cls, value: str, info: ValidationInfo) -> str:
        return _require_choice(value, _options_for(info).patterns)

    @field_validator("image_fit")
    @classmethod
    def _known_image_fit(cls, value: str, info: ValidationInfo) -> str:
        return _require_choice(value, _options_for(info).image_fits)


class ThemeIn(ApiModel):
    """A complete theme, validated strictly.

    Unknown keys are rejected, colors must be ``#RRGGBB`` (stored upper-case), every
    choice must be a key from the options file and ``preset`` is a preset key or
    ``"custom"``. Whether ``image_upload_id`` exists and is owned is checked by the
    profile service. Store ``model_dump(mode="json")``.
    """

    preset: str
    colors: ThemeColorsIn
    fonts: ThemeFontsIn
    background: ThemeBackgroundIn
    card_style: str
    default_view: str

    @field_validator("preset")
    @classmethod
    def _known_preset(cls, value: str, info: ValidationInfo) -> str:
        return _require_choice(value, frozenset({*_options_for(info).presets, CUSTOM_PRESET}))

    @field_validator("card_style")
    @classmethod
    def _known_card_style(cls, value: str, info: ValidationInfo) -> str:
        return _require_choice(value, _options_for(info).card_styles)

    @field_validator("default_view")
    @classmethod
    def _known_default_view(cls, value: str, info: ValidationInfo) -> str:
        return _require_choice(value, _options_for(info).default_views)


# --- Lenient normalization ---------------------------------------------------------------


def normalize_theme(stored: object, options: ThemeOptions | None = None) -> dict[str, Any]:
    """Return a complete, valid theme built from a stored (possibly stale) value.

    Stored values are deep-merged over the theme of ``stored["preset"]`` when that is a
    current preset key, otherwise over the default preset. Unknown or invalid keys and
    values are dropped, and an unknown or removed preset becomes ``"custom"``.

    Args:
        stored: The value of ``users.theme`` (anything; non-objects count as empty).
        options: Options to use instead of the process-wide ones.

    Returns:
        A new dict that satisfies :class:`ThemeIn`.
    """
    opts = options or get_theme_options()
    data = _as_mapping(stored)
    preset = data.get("preset")
    current_preset = preset if isinstance(preset, str) and preset in opts.presets else None
    theme = opts.preset_theme(current_preset or opts.default_preset)
    if "preset" in data:
        theme["preset"] = current_preset or CUSTOM_PRESET

    colors = _as_mapping(data.get("colors"))
    for name in COLOR_NAMES:
        color = colors.get(name)
        if isinstance(color, str) and _HEX_COLOR.fullmatch(color):
            theme["colors"][name] = color.upper()

    fonts = _as_mapping(data.get("fonts"))
    for role in FONT_ROLES:
        _merge_choice(theme["fonts"], fonts, role, opts.fonts)

    background = _as_mapping(data.get("background"))
    _merge_choice(theme["background"], background, "pattern", opts.patterns)
    _merge_choice(theme["background"], background, "image_fit", opts.image_fits)
    theme["background"]["image_upload_id"] = _canonical_uuid(background.get("image_upload_id"))

    _merge_choice(theme, data, "card_style", opts.card_styles)
    _merge_choice(theme, data, "default_view", opts.default_views)
    return theme


def _as_mapping(value: object) -> Mapping[str, object]:
    return value if isinstance(value, Mapping) else {}


def _merge_choice(
    target: dict[str, Any], source: Mapping[str, object], key: str, choices: frozenset[str]
) -> None:
    value = source.get(key)
    if isinstance(value, str) and value in choices:
        target[key] = value


def _canonical_uuid(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return None


# --- Loading -------------------------------------------------------------------------------


class _Option(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9-]*$")]


class _Preset(_Option):
    theme: dict[str, Any]


class _OptionsFile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    version: Literal[1]
    default_preset: str
    fonts: list[_Option]
    patterns: list[_Option]
    image_fits: list[_Option]
    card_styles: list[_Option]
    default_views: list[_Option]
    note_colors: list[_Option]
    presets: list[_Preset]


def theme_options_path() -> Path:
    """Return the options file path: ``THEME_OPTIONS_PATH`` or the source-checkout default."""
    configured = os.environ.get(THEME_OPTIONS_ENV, "").strip()
    return Path(configured) if configured else DEFAULT_THEME_OPTIONS_PATH


@cache
def get_theme_options() -> ThemeOptions:
    """Return the process-wide theme options, loading them on first use.

    Raises:
        ThemeOptionsError: If the file is missing or invalid.
    """
    return load_theme_options(theme_options_path())


def note_color_keys() -> frozenset[str]:
    """Return the allowed annotation colors."""
    return get_theme_options().note_colors


def load_theme_options(path: Path) -> ThemeOptions:
    """Read and validate a theme options file.

    Args:
        path: The JSON file to read.

    Returns:
        The validated options.

    Raises:
        ThemeOptionsError: Listing what is wrong with the file.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        parsed = _OptionsFile.model_validate(raw)
    except (OSError, ValueError) as exc:  # ValidationError is a ValueError.
        raise ThemeOptionsError(f"Cannot load theme options from {path}: {exc}") from exc

    problems: list[str] = []
    preset_keys = _unique_keys("presets", parsed.presets, problems)
    options = ThemeOptions(
        default_preset=parsed.default_preset,
        fonts=_unique_keys("fonts", parsed.fonts, problems),
        patterns=_unique_keys("patterns", parsed.patterns, problems),
        image_fits=_unique_keys("image_fits", parsed.image_fits, problems),
        card_styles=_unique_keys("card_styles", parsed.card_styles, problems),
        default_views=_unique_keys("default_views", parsed.default_views, problems),
        note_colors=_unique_keys("note_colors", parsed.note_colors, problems),
        presets=MappingProxyType({key: {} for key in preset_keys}),
    )
    if CUSTOM_PRESET in preset_keys:
        problems.append(f'"{CUSTOM_PRESET}" is reserved and cannot be a preset key.')
    if parsed.default_preset not in preset_keys:
        problems.append(f"default_preset {parsed.default_preset!r} is not a preset key.")
    if DEFAULT_NOTE_COLOR not in options.note_colors:
        problems.append(f"note_colors must include {DEFAULT_NOTE_COLOR!r} (the database default).")

    presets = {
        preset.key: theme
        for preset in parsed.presets
        if (theme := _validated_preset(preset, options, problems)) is not None
    }
    if problems:
        details = "\n".join(f"  - {problem}" for problem in problems)
        raise ThemeOptionsError(f"Invalid theme options in {path}:\n{details}")
    return replace(options, presets=MappingProxyType(presets))


def _unique_keys(name: str, items: Sequence[_Option], problems: list[str]) -> frozenset[str]:
    keys = [item.key for item in items]
    duplicates = sorted({key for key in keys if keys.count(key) > 1})
    if duplicates:
        problems.append(f"{name} has duplicate keys: {', '.join(duplicates)}.")
    if not keys:
        problems.append(f"{name} must not be empty.")
    return frozenset(keys)


def _validated_preset(
    preset: _Preset, options: ThemeOptions, problems: list[str]
) -> dict[str, Any] | None:
    try:
        theme = ThemeIn.model_validate(preset.theme, context={_OPTIONS_CONTEXT_KEY: options})
    except ValidationError as exc:
        problems.append(f"preset {preset.key!r} is not a valid theme: {exc}")
        return None
    if theme.preset != preset.key:
        problems.append(f"preset {preset.key!r} must set theme.preset to {preset.key!r}.")
    if theme.background.image_upload_id is not None:
        problems.append(f"preset {preset.key!r} must not reference an uploaded image.")
    dumped: dict[str, Any] = theme.model_dump(mode="json")
    return dumped
