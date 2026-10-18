from __future__ import annotations

import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from sotd.api.utils import validation_error_from
from sotd.theme import (
    CUSTOM_PRESET,
    DEFAULT_THEME_OPTIONS_PATH,
    ThemeIn,
    ThemeOptions,
    ThemeOptionsError,
    get_theme_options,
    load_theme_options,
    normalize_theme,
    note_color_keys,
    theme_options_path,
)

UPLOAD_ID = "6f1c2a5e-8d1b-4c1e-9f57-0b6f7d2a9c11"
RAW_OPTIONS: dict[str, Any] = json.loads(DEFAULT_THEME_OPTIONS_PATH.read_text(encoding="utf-8"))
PRESETS: dict[str, dict[str, Any]] = {p["key"]: p["theme"] for p in RAW_OPTIONS["presets"]}

OptionsWriter = Callable[[Callable[[dict[str, Any]], None]], Path]


@pytest.fixture
def options() -> ThemeOptions:
    return get_theme_options()


@pytest.fixture
def write_options(tmp_path: Path) -> OptionsWriter:
    """Write a modified copy of the real options file and return its path."""

    def write(mutate: Callable[[dict[str, Any]], None]) -> Path:
        data = copy.deepcopy(RAW_OPTIONS)
        mutate(data)
        path = tmp_path / "theme-options.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        return path

    return write


def chrome() -> dict[str, Any]:
    return copy.deepcopy(PRESETS["chrome"])


def theme_errors(data: object) -> dict[str, str]:
    with pytest.raises(ValidationError) as excinfo:
        ThemeIn.model_validate(data)
    fields: dict[str, str] = validation_error_from(excinfo.value).fields or {}
    return fields


# --- Loading ----------------------------------------------------------------------------


def test_real_options_file_loads(options: ThemeOptions) -> None:
    assert options.default_preset == "chrome"
    assert set(options.presets) == set(PRESETS)
    assert options.fonts == {font["key"] for font in RAW_OPTIONS["fonts"]}
    assert options.patterns == {"none", "grid", "dots", "stars", "checker", "stripes", "scanlines"}
    assert options.image_fits == {"cover", "tile"}
    assert options.card_styles == {"window", "polaroid", "minimal"}
    assert options.default_views == {"board", "calendar"}


def test_note_color_keys() -> None:
    assert note_color_keys() == {"yellow", "pink", "blue", "green", "purple"}


def test_options_are_cached(options: ThemeOptions) -> None:
    assert get_theme_options() is options


def test_preset_theme_returns_an_independent_copy(options: ThemeOptions) -> None:
    theme = options.preset_theme("chrome")
    theme["colors"]["text"] = "#000000"
    assert options.preset_theme("chrome")["colors"]["text"] == PRESETS["chrome"]["colors"]["text"]
    with pytest.raises(TypeError):
        options.presets["chrome"] = {}  # type: ignore[index]


def test_options_path_defaults_to_the_shared_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("THEME_OPTIONS_PATH", raising=False)
    assert theme_options_path() == DEFAULT_THEME_OPTIONS_PATH
    assert DEFAULT_THEME_OPTIONS_PATH.parts[-2:] == ("shared", "theme-options.json")


def test_options_path_comes_from_the_environment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("THEME_OPTIONS_PATH", str(tmp_path / "options.json"))
    assert theme_options_path() == tmp_path / "options.json"


def test_options_from_the_environment_are_used(
    monkeypatch: pytest.MonkeyPatch, write_options: OptionsWriter
) -> None:
    def keep_two_presets(data: dict[str, Any]) -> None:
        data["presets"] = data["presets"][:2]

    monkeypatch.setenv("THEME_OPTIONS_PATH", str(write_options(keep_two_presets)))
    get_theme_options.cache_clear()
    try:
        assert set(get_theme_options().presets) == {"chrome", "bubblegum"}
    finally:
        monkeypatch.delenv("THEME_OPTIONS_PATH")
        get_theme_options.cache_clear()


def test_missing_file(tmp_path: Path) -> None:
    with pytest.raises(ThemeOptionsError, match="Cannot load theme options"):
        load_theme_options(tmp_path / "missing.json")


def test_malformed_json(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text("{", encoding="utf-8")
    with pytest.raises(ThemeOptionsError, match="Cannot load theme options"):
        load_theme_options(path)


def _set(path: str, value: object) -> Callable[[dict[str, Any]], None]:
    def mutate(data: dict[str, Any]) -> None:
        *parents, last = path.split(".")
        target: Any = data
        for part in parents:
            target = target[int(part)] if part.isdigit() else target[part]
        target[last] = value

    return mutate


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (_set("version", 2), "Cannot load theme options"),
        (_set("fonts", [{"key": "Bad Key"}]), "Cannot load theme options"),
        (_set("patterns", [{"key": "grid"}, {"key": "grid"}]), "patterns has duplicate keys: grid"),
        (_set("card_styles", []), "card_styles must not be empty"),
        (_set("default_preset", "nope"), "default_preset 'nope' is not a preset key"),
        (_set("note_colors", [{"key": "pink"}]), "note_colors must include 'yellow'"),
        (_set("presets.0.key", "custom"), '"custom" is reserved'),
        (_set("presets.1.theme.colors.text", "red"), "preset 'bubblegum' is not a valid theme"),
        (_set("presets.1.theme.fonts.body", "papyrus"), "preset 'bubblegum' is not a valid theme"),
        (_set("presets.1.theme.preset", "chrome"), "must set theme.preset to 'bubblegum'"),
        (
            _set("presets.1.theme.background.image_upload_id", UPLOAD_ID),
            "preset 'bubblegum' must not reference an uploaded image",
        ),
    ],
)
def test_invalid_options_are_rejected(
    write_options: OptionsWriter, mutate: Callable[[dict[str, Any]], None], message: str
) -> None:
    with pytest.raises(ThemeOptionsError, match=message):
        load_theme_options(write_options(mutate))


def test_every_problem_is_listed(write_options: OptionsWriter) -> None:
    def break_twice(data: dict[str, Any]) -> None:
        data["default_preset"] = "nope"
        data["image_fits"] = []

    with pytest.raises(ThemeOptionsError) as excinfo:
        load_theme_options(write_options(break_twice))
    assert "default_preset 'nope'" in str(excinfo.value)
    assert "image_fits must not be empty" in str(excinfo.value)


# --- ThemeIn ---------------------------------------------------------------------------------


@pytest.mark.parametrize("key", sorted(PRESETS))
def test_every_preset_validates(key: str) -> None:
    theme = ThemeIn.model_validate(PRESETS[key])
    assert theme.model_dump(mode="json") == PRESETS[key]


def test_custom_preset_and_upload_id_are_accepted() -> None:
    data = chrome()
    data["preset"] = CUSTOM_PRESET
    data["background"]["image_upload_id"] = UPLOAD_ID.upper()
    data["background"]["image_fit"] = "tile"
    dumped = ThemeIn.model_validate(data).model_dump(mode="json")
    assert dumped["preset"] == "custom"
    assert dumped["background"]["image_upload_id"] == UPLOAD_ID


def test_colors_are_stored_upper_case() -> None:
    data = chrome()
    data["colors"]["accent"] = "#5b4bff"
    data["colors"]["text"] = "  #aBcDeF  "
    colors = ThemeIn.model_validate(data).model_dump(mode="json")["colors"]
    assert colors["accent"] == "#5B4BFF"
    assert colors["text"] == "#ABCDEF"


@pytest.mark.parametrize("color", ["#FFF", "#GGGGGG", "red", "FFFFFF", "#FFFFFF0", "", "#12345"])
def test_bad_colors_are_rejected(color: str) -> None:
    data = chrome()
    data["colors"]["surface"] = color
    assert theme_errors(data) == {"colors.surface": "Must be a #RRGGBB color."}


@pytest.mark.parametrize(
    ("path", "field"),
    [
        ("preset", "preset"),
        ("fonts.heading", "fonts.heading"),
        ("fonts.body", "fonts.body"),
        ("background.pattern", "background.pattern"),
        ("background.image_fit", "background.image_fit"),
        ("card_style", "card_style"),
        ("default_view", "default_view"),
    ],
)
def test_unknown_choices_are_rejected(path: str, field: str) -> None:
    data = chrome()
    _set(path, "comic-sans")(data)
    errors = theme_errors(data)
    assert list(errors) == [field]
    assert errors[field].startswith("Must be one of: ")


def test_choice_error_lists_the_options() -> None:
    data = chrome()
    data["default_view"] = "list"
    assert theme_errors(data) == {"default_view": "Must be one of: board, calendar."}


def test_unknown_keys_are_rejected_at_every_level() -> None:
    data = chrome()
    data["css"] = "body{}"
    data["colors"]["link"] = "#000000"
    data["background"]["blur"] = 3
    assert theme_errors(data) == {
        "css": "Unknown field.",
        "colors.link": "Unknown field.",
        "background.blur": "Unknown field.",
    }


def test_theme_must_be_complete() -> None:
    data = chrome()
    del data["fonts"]
    del data["colors"]["border"]
    del data["background"]["image_upload_id"]
    assert theme_errors(data) == {
        "colors.border": "This field is required.",
        "fonts": "This field is required.",
        "background.image_upload_id": "This field is required.",
    }


@pytest.mark.parametrize(
    ("change", "field", "message"),
    [
        (_set("card_style", None), "card_style", "Cannot be null."),
        (_set("colors", "pink"), "colors", "Must be an object."),
        (
            _set("background.image_upload_id", "not-a-uuid"),
            "background.image_upload_id",
            "Must be a valid UUID.",
        ),
        (_set("default_view", 1), "default_view", "Must be a string."),
    ],
)
def test_wrong_types_are_rejected(
    change: Callable[[dict[str, Any]], None], field: str, message: str
) -> None:
    data = chrome()
    change(data)
    assert theme_errors(data) == {field: message}


def test_a_validation_context_without_options_uses_the_global_ones() -> None:
    assert ThemeIn.model_validate(chrome(), context={"unrelated": True}).preset == "chrome"


# --- normalize_theme --------------------------------------------------------------------------


@pytest.mark.parametrize("stored", [{}, None, [], "chrome", 42])
def test_empty_or_non_object_values_give_the_default_preset(stored: object) -> None:
    assert normalize_theme(stored) == PRESETS["chrome"]


def test_result_is_a_fresh_copy() -> None:
    first = normalize_theme({})
    first["colors"]["text"] = "#000000"
    assert normalize_theme({})["colors"]["text"] == PRESETS["chrome"]["colors"]["text"]


def test_stored_preset_is_the_merge_base() -> None:
    stored = {"preset": "bubblegum", "fonts": {"body": "inter"}}
    expected = copy.deepcopy(PRESETS["bubblegum"])
    expected["fonts"]["body"] = "inter"
    assert normalize_theme(stored) == expected


def test_partial_theme_is_merged_over_the_default_preset() -> None:
    stored = {
        "colors": {"text": "#abcdef"},
        "background": {"image_upload_id": UPLOAD_ID, "image_fit": "tile"},
        "default_view": "calendar",
    }
    expected = chrome()
    expected["colors"]["text"] = "#ABCDEF"
    expected["background"]["image_upload_id"] = UPLOAD_ID
    expected["background"]["image_fit"] = "tile"
    expected["default_view"] = "calendar"
    assert normalize_theme(stored) == expected


@pytest.mark.parametrize("preset", ["vaporwave", "custom", "", 7, None])
def test_unknown_preset_becomes_custom(preset: object) -> None:
    stored = {"preset": preset, "card_style": "minimal"}
    expected = chrome()
    expected["preset"] = CUSTOM_PRESET
    expected["card_style"] = "minimal"
    assert normalize_theme(stored) == expected


def test_invalid_values_and_unknown_keys_are_dropped() -> None:
    stored = {
        "preset": "midnight-crt",
        "colors": {"text": "green", "accent": "#12345", "border": 5, "glow": "#FFFFFF"},
        "fonts": {"heading": "papyrus", "body": None},
        "background": {"pattern": "plaid", "image_fit": "stretch", "image_upload_id": "nope"},
        "card_style": ["window"],
        "default_view": "list",
        "css": "body { display: none }",
    }
    assert normalize_theme(stored) == PRESETS["midnight-crt"]


def test_non_object_sections_are_ignored() -> None:
    stored = {"preset": "paper", "colors": "red", "fonts": [], "background": 1}
    assert normalize_theme(stored) == PRESETS["paper"]


def test_upload_id_is_canonicalized() -> None:
    stored = {"background": {"image_upload_id": UPLOAD_ID.upper().replace("-", "")}}
    assert normalize_theme(stored)["background"]["image_upload_id"] == UPLOAD_ID


@pytest.mark.parametrize(
    "stored",
    [
        {},
        {"preset": "gone", "colors": {"text": "#010203"}},
        {"preset": "sunset-mixtape", "background": {"image_upload_id": UPLOAD_ID}},
        {"colors": None, "fonts": {"heading": "vt323"}},
    ],
)
def test_normalized_themes_always_pass_strict_validation(stored: dict[str, Any]) -> None:
    normalized = normalize_theme(stored)
    assert ThemeIn.model_validate(normalized).model_dump(mode="json") == normalized


def test_explicit_options_are_used(write_options: OptionsWriter) -> None:
    def make_paper_default(data: dict[str, Any]) -> None:
        data["default_preset"] = "paper"

    custom = load_theme_options(write_options(make_paper_default))
    assert normalize_theme({}, custom) == PRESETS["paper"]
