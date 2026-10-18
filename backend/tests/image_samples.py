"""Image files generated with Pillow for the upload tests (nothing binary is committed)."""

from __future__ import annotations

import hashlib
import io
import struct
import zlib
from typing import Any, Final

from PIL import Image
from werkzeug.datastructures import FileStorage, MultiDict
from werkzeug.test import encode_multipart

#: EXIF tag of the orientation; 6 means "rotate 90° clockwise to display".
ORIENTATION_TAG: Final = 0x0112
#: Metadata payloads that must never reach a stored image.
CAMERA_MAKE: Final = "Secret Camera Maker"
XMP_PACKET: Final = b"<x:xmpmeta><rdf:Description>secret location</rdf:Description></x:xmpmeta>"
ICC_PROFILE: Final = b"not really an ICC profile" * 4
RED: Final = (255, 0, 0)
BLUE: Final = (0, 0, 255)

PNG_SIGNATURE: Final = b"\x89PNG\r\n\x1a\n"

#: Files of formats that must be refused with 415.
SVG: Final = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'
PSD_HEADER: Final = b"8BPS\x00\x01" + bytes(6) + struct.pack(">HIIHH", 3, 10, 10, 8, 3) + bytes(64)
HEIC_HEADER: Final = struct.pack(">I", 24) + b"ftypheic" + bytes(4) + b"mif1heic" + bytes(64)
PDF: Final = b"%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"


def encode(image: Image.Image, image_format: str, **options: Any) -> bytes:
    """Encode ``image`` in memory."""
    buffer = io.BytesIO()
    image.save(buffer, format=image_format, **options)
    return buffer.getvalue()


def solid(
    size: tuple[int, int], color: tuple[int, ...] | int = RED, mode: str = "RGB"
) -> Image.Image:
    """Return a single-color image."""
    return Image.new(mode, size, color)


def gradient(size: tuple[int, int]) -> Image.Image:
    """Return an RGB gradient (cheap to encode, but not a flat color)."""
    return Image.linear_gradient("L").resize(size).convert("RGB")


def jpeg(size: tuple[int, int] = (40, 20), *, orientation: int | None = None) -> bytes:
    """Return a red JPEG; with an orientation, also EXIF (Make), XMP and ICC metadata."""
    options: dict[str, Any] = {"quality": 90}
    if orientation is not None:
        exif = Image.Exif()
        exif[ORIENTATION_TAG] = orientation
        exif[0x010F] = CAMERA_MAKE  # Make
        options.update(exif=exif.tobytes(), xmp=XMP_PACKET, icc_profile=ICC_PROFILE)
    return encode(solid(size), "JPEG", **options)


def png16(pixels: list[int], size: tuple[int, int], **options: Any) -> bytes:
    """Return a 16-bit grayscale PNG (opened by Pillow as ``I;16``) with these samples."""
    image = Image.new("I;16", size)
    image.putdata(pixels)
    return encode(image, "PNG", **options)


def png(size: tuple[int, int] = (40, 20), mode: str = "RGB", **options: Any) -> bytes:
    """Return a red PNG in ``mode``."""
    colors: dict[str, tuple[int, ...] | int] = {
        "RGBA": (*RED, 128),
        "LA": (128, 128),
        "L": 128,
        "1": 1,
        "I;16": 1000,
    }
    color = colors.get(mode, RED)
    return encode(solid(size, color, mode), "PNG", **options)


def mpo(size: tuple[int, int] = (40, 20)) -> bytes:
    """Return a two-picture MPO (a red frame, then a blue one), as phones produce."""
    return encode(solid(size, RED), "MPO", save_all=True, append_images=[solid(size, BLUE)])


def animated(image_format: str, size: tuple[int, int] = (40, 20)) -> bytes:
    """Return an animated GIF or WebP whose first frame is red and second blue."""
    first, second = solid(size, RED), solid(size, BLUE)
    return encode(first, image_format, save_all=True, append_images=[second], duration=100, loop=0)


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    crc = zlib.crc32(kind + payload)
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)


def png_header_only(width: int, height: int) -> bytes:
    """Return a PNG that declares ``width`` x ``height`` but holds no pixel data."""
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return PNG_SIGNATURE + _png_chunk(b"IHDR", header) + _png_chunk(b"IEND", b"")


def random_bytes(size: int = 2048, seed: int = 0) -> bytes:
    """Return deterministic pseudo-random bytes."""
    return hashlib.shake_256(f"sotd-test-bytes-{seed}".encode()).digest(size)


def is_lossless_webp(data: bytes) -> bool:
    """Return whether ``data`` is a WebP with a lossless (``VP8L``) bitstream."""
    return data[:4] == b"RIFF" and data[8:12] == b"WEBP" and b"VP8L" in data[12:]


def is_lossy_webp(data: bytes) -> bool:
    """Return whether ``data`` is a WebP with a lossy (``VP8``) bitstream."""
    return data[:4] == b"RIFF" and data[8:12] == b"WEBP" and b"VP8 " in data[12:]


def open_webp(data: bytes) -> Image.Image:
    """Decode an encoded result, checking that it is a single-frame WebP."""
    image = Image.open(io.BytesIO(data))
    assert image.format == "WEBP"
    assert getattr(image, "n_frames", 1) == 1
    image.load()
    return image


def multipart(
    *files: bytes | tuple[str, bytes], fields: dict[str, str] | None = None
) -> dict[str, Any]:
    """Return ``post()`` arguments for a multipart body.

    Each file goes in the ``file`` field unless given as ``(field, data)``. The body is
    encoded up front so the test client sends it from memory (letting the client encode
    large files spools them to temporary files it never closes).
    """
    values: MultiDict[str, Any] = MultiDict()
    for item in files:
        name, data = item if isinstance(item, tuple) else ("file", item)
        values.add(name, FileStorage(io.BytesIO(data), filename="image", name=name))
    for name, value in (fields or {}).items():
        values.add(name, value)
    boundary, body = encode_multipart(values)
    return {"data": body, "content_type": f"multipart/form-data; boundary={boundary}"}
