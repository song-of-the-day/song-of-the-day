"""Image decoding, sanitizing and re-encoding, without HTTP."""

from __future__ import annotations

import random
from collections.abc import Callable

import pytest
from PIL import Image

from sotd.errors import ApiError
from sotd.services import images
from sotd.services.images import EncodedImage, check_dimensions, process_image
from tests import image_samples as samples


def rejected(data: bytes) -> ApiError:
    with pytest.raises(ApiError) as excinfo:
        process_image(data)
    return excinfo.value


def outcome(data: bytes) -> EncodedImage | ApiError:
    """Return the result of processing ``data``, or the error it was rejected with."""
    try:
        return process_image(data)
    except ApiError as error:
        return error


def test_pillow_flags_decompression_bombs_at_the_pixel_limit() -> None:
    assert Image.MAX_IMAGE_PIXELS == images.MAX_SOURCE_PIXELS == 40_000_000


# --- Orientation, frames and metadata ---------------------------------------------------


def test_exif_orientation_is_applied_and_metadata_dropped() -> None:
    result = process_image(samples.jpeg((40, 20), orientation=6))

    assert (result.width, result.height) == (20, 40)
    assert result.content_type == "image/webp"
    decoded = samples.open_webp(result.data)
    assert decoded.size == (20, 40)
    assert not decoded.getexif()
    assert not {"exif", "icc_profile", "xmp"} & set(decoded.info)
    for leaked in (b"EXIF", b"ICCP", b"XMP ", samples.CAMERA_MAKE.encode(), b"secret location"):
        assert leaked not in result.data


def test_png_metadata_is_dropped() -> None:
    exif = Image.Exif()
    exif[samples.ORIENTATION_TAG] = 1
    data = samples.png(exif=exif.tobytes(), icc_profile=b"fake profile" * 8)
    result = process_image(data)
    decoded = samples.open_webp(result.data)
    assert not {"exif", "icc_profile", "xmp"} & set(decoded.info)
    assert b"EXIF" not in result.data
    assert b"ICCP" not in result.data


def test_mpo_is_accepted_as_its_first_picture() -> None:
    result = process_image(samples.mpo((40, 20)))
    decoded = samples.open_webp(result.data)
    assert decoded.size == (40, 20)
    assert decoded.convert("RGB").getpixel((20, 10)) == pytest.approx(samples.RED, abs=8)


@pytest.mark.parametrize("image_format", ["GIF", "WEBP"])
def test_animations_are_flattened_to_their_first_frame(image_format: str) -> None:
    result = process_image(samples.animated(image_format))
    decoded = samples.open_webp(result.data)
    assert decoded.convert("RGB").getpixel((20, 10)) == pytest.approx(samples.RED, abs=8)


# --- Color modes ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("make", "mode"),
    [
        (lambda: samples.png(mode="RGBA"), "RGBA"),
        (lambda: samples.png(mode="LA"), "RGBA"),
        (lambda: samples.png(mode="P", transparency=0), "RGBA"),
        (lambda: samples.encode(samples.solid((8, 8)), "GIF", transparency=0), "RGBA"),
        (lambda: samples.png(mode="P"), "RGB"),
        (lambda: samples.png(mode="L"), "RGB"),
        (lambda: samples.png(mode="1"), "RGB"),
        (lambda: samples.png(mode="I;16"), "RGB"),
        (lambda: samples.png16([1000] * 64, (8, 8), transparency=1000), "RGBA"),
        (lambda: samples.encode(samples.solid((8, 8), (0, 0, 0, 0), "CMYK"), "JPEG"), "RGB"),
        (lambda: samples.encode(samples.solid((8, 8), 50, "L"), "JPEG"), "RGB"),
    ],
    ids=[
        "rgba",
        "la",
        "p-transparent",
        "gif-transparent",
        "p",
        "l",
        "1",
        "i16",
        "i16-transparent",
        "cmyk",
        "jpeg-l",
    ],
)
def test_images_are_converted_to_rgb_or_rgba(make: Callable[[], bytes], mode: str) -> None:
    assert samples.open_webp(process_image(make()).data).mode == mode


def test_sixteen_bit_grayscale_keeps_its_tones() -> None:
    # Clipping to 8 bits would turn everything above 255 white.
    result = process_image(samples.png16([0, 255, 40_000, 65_535], (4, 1)))
    decoded = samples.open_webp(result.data)
    tones = [decoded.getpixel((x, 0)) for x in range(4)]
    assert tones == [(0, 0, 0), (0, 0, 0), (156, 156, 156), (255, 255, 255)]


def test_sixteen_bit_transparent_value_is_reduced_too() -> None:
    data = samples.png16([40_000, 1_000], (2, 1), transparency=40_000)
    decoded = samples.open_webp(process_image(data).data)
    transparent = decoded.getpixel((0, 0))
    assert isinstance(transparent, tuple)
    assert transparent[3] == 0  # Lossless WebP may drop the color under full transparency.
    assert decoded.getpixel((1, 0)) == (3, 3, 3, 255)


# --- Size and encoding ------------------------------------------------------------------


def test_small_png_is_encoded_losslessly() -> None:
    result = process_image(samples.png((40, 20)))
    assert samples.is_lossless_webp(result.data)
    assert samples.open_webp(result.data).getpixel((0, 0)) == samples.RED


@pytest.mark.parametrize("image_format", ["GIF", "WEBP"])
def test_small_gif_and_webp_are_encoded_losslessly(image_format: str) -> None:
    data = samples.encode(samples.solid((40, 20)), image_format)
    assert samples.is_lossless_webp(process_image(data).data)


def test_png_of_exactly_four_megapixels_is_still_lossless() -> None:
    result = process_image(samples.encode(samples.gradient((2000, 2000)), "PNG"))
    assert (result.width, result.height) == (2000, 2000)
    assert samples.is_lossless_webp(result.data)


def test_png_over_four_megapixels_is_encoded_lossy() -> None:
    result = process_image(samples.encode(samples.gradient((2001, 2000)), "PNG"))
    assert (result.width, result.height) == (2001, 2000)
    assert samples.is_lossy_webp(result.data)


def test_losslessness_depends_on_the_downscaled_size() -> None:
    # 8.2 MP in, 2560x800 (2 MP) out: small enough for lossless once downscaled.
    result = process_image(samples.encode(samples.gradient((5120, 1600)), "PNG"))
    assert (result.width, result.height) == (2560, 800)
    assert samples.is_lossless_webp(result.data)


def test_jpeg_is_encoded_lossy_whatever_its_size() -> None:
    assert samples.is_lossy_webp(process_image(samples.jpeg((40, 20))).data)


def test_large_jpeg_is_downscaled_to_fit_2560() -> None:
    result = process_image(samples.encode(samples.gradient((4000, 3000)), "JPEG"))
    assert (result.width, result.height) == (2560, 1920)
    assert samples.open_webp(result.data).size == (2560, 1920)
    assert samples.is_lossy_webp(result.data)


def test_tall_image_is_downscaled_to_fit_2560() -> None:
    result = process_image(samples.png((300, 6000), mode="L"))
    assert (result.width, result.height) == (128, 2560)


def test_result_over_the_output_limit_is_413(monkeypatch: pytest.MonkeyPatch) -> None:
    data = samples.png((40, 20))
    size = len(process_image(data).data)
    monkeypatch.setattr(images, "MAX_OUTPUT_BYTES", size - 1)
    error = rejected(data)
    assert (error.status, error.code) == (413, "payload_too_large")
    monkeypatch.setattr(images, "MAX_OUTPUT_BYTES", size)
    assert isinstance(process_image(data), EncodedImage)


# --- Rejections -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "make",
    [
        lambda: samples.SVG,
        lambda: samples.PSD_HEADER,
        lambda: samples.HEIC_HEADER,
        lambda: samples.PDF,
        lambda: samples.encode(samples.solid((8, 8)), "EPS"),
        lambda: samples.encode(samples.solid((8, 8)), "TGA"),
        lambda: samples.encode(samples.solid((8, 8)), "BMP"),
        lambda: samples.encode(samples.solid((8, 8)), "TIFF"),
        lambda: samples.encode(samples.solid((16, 16)), "ICO"),
        lambda: samples.random_bytes(),
        lambda: b"x",
    ],
    ids=["svg", "psd", "heic", "pdf", "eps", "tga", "bmp", "tiff", "ico", "random", "one-byte"],
)
def test_unsupported_formats_are_415(make: Callable[[], bytes]) -> None:
    error = rejected(make())
    assert (error.status, error.code) == (415, "unsupported_media_type")
    assert error.message == "Upload a JPEG, PNG, WebP or GIF image."


def test_identified_formats_must_also_be_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(images, "ACCEPTED_FORMATS", frozenset({"JPEG", "MPO"}))
    error = rejected(samples.png())
    assert (error.status, error.code) == (415, "unsupported_media_type")


@pytest.mark.parametrize(
    ("width", "height"),
    [(20_000, 20_000), (7000, 7000), (8001, 10), (10, 8001), (8000, 5001)],
    ids=["bomb-error", "bomb-warning", "too-wide", "too-tall", "over-40mp"],
)
def test_images_over_the_dimension_limits_are_422(width: int, height: int) -> None:
    error = rejected(samples.png_header_only(width, height))
    assert (error.status, error.code) == (422, "invalid_image")
    assert error.message == (
        "This image is too large. Use one at most 8000 pixels on each side and "
        "40 megapixels in total."
    )


@pytest.mark.parametrize(("width", "height"), [(8000, 5000), (5000, 8000), (1, 1)])
def test_dimension_limits_are_inclusive(width: int, height: int) -> None:
    check_dimensions(width, height)


def test_an_identified_image_without_pixel_data_is_422() -> None:
    error = rejected(samples.png_header_only(100, 100))
    assert (error.status, error.code) == (422, "invalid_image")
    assert error.message == "This image can't be read. Try another file."


@pytest.mark.parametrize("image_format", ["JPEG", "PNG", "WEBP", "GIF"])
def test_truncated_images_are_422(image_format: str) -> None:
    data = samples.encode(samples.gradient((64, 64)), image_format)
    error = rejected(data[: len(data) // 2])
    assert (error.status, error.code) == (422, "invalid_image")


@pytest.mark.parametrize(
    "make",
    [
        lambda: samples.jpeg((64, 48), orientation=6),
        lambda: samples.mpo((64, 48)),
        lambda: samples.png((64, 48), mode="RGBA"),
        lambda: samples.png((64, 48), mode="P", transparency=0),
        lambda: samples.animated("GIF", (64, 48)),
        lambda: samples.animated("WEBP", (64, 48)),
        lambda: samples.encode(samples.gradient((64, 48)), "WEBP", lossless=True),
    ],
    ids=["jpeg-exif", "mpo", "png-rgba", "png-p", "gif", "webp", "webp-lossless"],
)
def test_corrupted_files_never_fail_unexpectedly(make: Callable[[], bytes]) -> None:
    """Truncated or damaged files either still decode or are rejected with 415/422."""
    original = make()
    rng = random.Random(original)  # noqa: S311 - reproducible corruption, not a secret.
    for _ in range(150):
        data = bytearray(original)
        position = rng.randrange(len(data))
        match rng.randrange(3):
            case 0:
                del data[position:]
            case 1:
                data[position] ^= 1 << rng.randrange(8)
            case _:
                for _ in range(8):
                    data[rng.randrange(len(data))] = rng.randrange(256)
        result = outcome(bytes(data))
        if isinstance(result, ApiError):
            assert (result.status, result.code) in {
                (415, "unsupported_media_type"),
                (422, "invalid_image"),
            }
        else:
            assert samples.open_webp(result.data).size == (result.width, result.height)
