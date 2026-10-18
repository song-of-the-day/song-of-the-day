"""Decoding, sanitizing and re-encoding uploaded images.

:func:`process_image` turns untrusted bytes into a metadata-free WebP:

1. Only JPEG (including MPO), PNG, WebP and GIF are identified; anything else is
   ``415 unsupported_media_type``. Decompression bombs and images over the dimension
   limits are ``422 invalid_image``, and so is any file that fails to decode.
2. Only the first frame is kept. The EXIF orientation is applied, the image is converted
   to 8-bit RGB (RGBA when it has transparency) and downscaled to fit 2560x2560.
3. It is encoded to WebP once: lossless for PNG/GIF/WebP sources whose result is at most
   4 MP, otherwise lossy at quality 85. No EXIF, XMP or ICC metadata is written. A result
   over 5 MB is ``413 payload_too_large``.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass
from typing import Final

from PIL import Image, ImageOps, UnidentifiedImageError

from sotd.errors import ApiError

#: The only content type uploads are stored as.
WEBP_CONTENT_TYPE: Final = "image/webp"
#: Formats Pillow may try when identifying a file (MPO is detected by the JPEG plugin).
OPEN_FORMATS: Final = ("JPEG", "PNG", "WEBP", "GIF")
#: ``Image.format`` values that are accepted once identified.
ACCEPTED_FORMATS: Final = frozenset({"JPEG", "MPO", "PNG", "WEBP", "GIF"})
#: Source formats that are encoded losslessly when the result is small enough.
LOSSLESS_SOURCE_FORMATS: Final = frozenset({"PNG", "GIF", "WEBP"})
#: Largest accepted source width or height.
MAX_SOURCE_SIDE: Final = 8000
#: Largest accepted source area; Pillow warns above it and refuses above twice it.
MAX_SOURCE_PIXELS: Final = 40_000_000
#: Stored images fit in a square of this side.
MAX_OUTPUT_SIDE: Final = 2560
#: Largest result (in pixels) that is still encoded losslessly.
MAX_LOSSLESS_PIXELS: Final = 4_000_000
LOSSY_QUALITY: Final = 85
#: Largest stored image.
MAX_OUTPUT_BYTES: Final = 5_000_000

# Process-wide, so that Image.open() itself flags decompression bombs.
Image.MAX_IMAGE_PIXELS = MAX_SOURCE_PIXELS

# What Pillow raises for files it identified but cannot decode (as observed by fuzzing
# truncated and corrupted files of every accepted format).
_DECODE_ERRORS: Final = (OSError, SyntaxError, ValueError, EOFError)
# Modes of 16-bit grayscale PNGs. Pillow's conversions clip their samples to 255.
_WIDE_GRAYSCALE_MODES: Final = frozenset({"I", "I;16", "I;16B", "I;16L", "I;16N"})
# Written explicitly so that no source metadata can reach the output.
_NO_METADATA: Final = {"exif": b"", "xmp": b"", "icc_profile": None}


@dataclass(frozen=True, slots=True)
class EncodedImage:
    """A re-encoded image, ready to be stored.

    Attributes:
        data: The encoded bytes.
        width: Width in pixels.
        height: Height in pixels.
        content_type: The media type of ``data``.
    """

    data: bytes
    width: int
    height: int
    content_type: str = WEBP_CONTENT_TYPE


def unsupported_image() -> ApiError:
    """Return the ``415`` error for files that aren't an accepted image format."""
    return ApiError(415, "unsupported_media_type", "Upload a JPEG, PNG, WebP or GIF image.")


def invalid_image(message: str = "This image can't be read. Try another file.") -> ApiError:
    """Return the ``422 invalid_image`` error.

    Args:
        message: What is wrong with the image, safe to show to the user.
    """
    return ApiError(422, "invalid_image", message)


def _too_many_pixels() -> ApiError:
    return invalid_image(
        f"This image is too large. Use one at most {MAX_SOURCE_SIDE} pixels on each side "
        f"and {MAX_SOURCE_PIXELS // 1_000_000} megapixels in total."
    )


def check_dimensions(width: int, height: int) -> None:
    """Reject a source image that exceeds the dimension limits.

    Args:
        width: Source width in pixels.
        height: Source height in pixels.

    Raises:
        ApiError: ``422 invalid_image`` if a side exceeds :data:`MAX_SOURCE_SIDE` or the
            area exceeds :data:`MAX_SOURCE_PIXELS`.
    """
    if max(width, height) > MAX_SOURCE_SIDE or width * height > MAX_SOURCE_PIXELS:
        raise _too_many_pixels()


def process_image(data: bytes) -> EncodedImage:
    """Validate an uploaded file and re-encode it as a metadata-free WebP.

    Args:
        data: The uploaded file, as received.

    Returns:
        The encoded image.

    Raises:
        ApiError: ``415 unsupported_media_type`` for files that aren't JPEG, PNG, WebP
            or GIF; ``422 invalid_image`` for undecodable files and images over the
            dimension limits; ``413 payload_too_large`` if the result exceeds
            :data:`MAX_OUTPUT_BYTES`.
    """
    with warnings.catch_warnings():
        # Pillow reports harmless oddities of untrusted files (corrupt EXIF, palette
        # transparency) as UserWarning; metadata is dropped anyway.
        warnings.simplefilter("ignore", UserWarning)
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            image, lossless_source = _decode(data)
        except UnidentifiedImageError:
            raise unsupported_image() from None
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise _too_many_pixels() from None
        except _DECODE_ERRORS:
            raise invalid_image() from None
    lossless = lossless_source and image.width * image.height <= MAX_LOSSLESS_PIXELS
    return _encode(image, lossless=lossless)


def _decode(data: bytes) -> tuple[Image.Image, bool]:
    """Decode the first frame, upright, in RGB(A) and within the output bounds.

    Returns:
        The image and whether its source format qualifies for lossless encoding.
    """
    with Image.open(io.BytesIO(data), formats=OPEN_FORMATS) as source:
        source_format = source.format
        if source_format not in ACCEPTED_FORMATS:
            raise unsupported_image()
        check_dimensions(*source.size)
        if source_format in ("JPEG", "MPO"):
            # Lets libjpeg decode at a reduced scale that still covers the output size.
            source.draft("RGB", (MAX_OUTPUT_SIDE, MAX_OUTPUT_SIDE))
        source.load()  # Frame 0: Image.open() leaves multi-frame files on their first.
        image = _to_8_bit(ImageOps.exif_transpose(source))
    mode = "RGBA" if image.has_transparency_data else "RGB"
    if image.mode != mode:
        image = image.convert(mode)
    image.thumbnail((MAX_OUTPUT_SIDE, MAX_OUTPUT_SIDE), Image.Resampling.LANCZOS)
    return image, source_format in LOSSLESS_SOURCE_FORMATS


def _to_8_bit(image: Image.Image) -> Image.Image:
    """Reduce 16-bit grayscale to ``L`` by keeping each sample's high byte.

    Pillow's own conversion would clip every sample above 255, turning most of the image
    white. A ``tRNS`` transparent value is reduced the same way.
    """
    if image.mode not in _WIDE_GRAYSCALE_MODES:
        return image
    reduced = image.convert("I").point(lambda sample: sample / 256).convert("L")
    transparency = image.info.get("transparency")
    if isinstance(transparency, int):
        reduced.info["transparency"] = transparency >> 8
    return reduced


def _encode(image: Image.Image, *, lossless: bool) -> EncodedImage:
    """Encode ``image`` to WebP once, writing no EXIF, XMP or ICC metadata."""
    buffer = io.BytesIO()
    if lossless:
        image.save(buffer, format="WEBP", lossless=True, **_NO_METADATA)
    else:
        image.save(buffer, format="WEBP", quality=LOSSY_QUALITY, **_NO_METADATA)
    encoded = buffer.getvalue()
    if len(encoded) > MAX_OUTPUT_BYTES:
        raise ApiError(
            413,
            "payload_too_large",
            "This image is too large even after compression. Try a smaller one.",
        )
    return EncodedImage(data=encoded, width=image.width, height=image.height)
