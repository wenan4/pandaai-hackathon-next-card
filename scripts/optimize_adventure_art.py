"""Encode adventure PNG art as same-size WebP without changing the source files.

Requires Pillow with WebP support. Run from the repository root:
    python scripts/optimize_adventure_art.py
All *.png in public/art/adventure are picked up, including future additions.
Use --only to select individual PNG filenames for an incremental run.
"""
from __future__ import annotations

import argparse
from io import BytesIO
from math import log10, sqrt
from pathlib import Path
import sys
import tempfile

from PIL import Image, ImageChops, ImageStat, features

ART_DIR = Path(__file__).resolve().parents[1] / "public" / "art" / "adventure"


def encode(source: Path, quality: int, method: int) -> tuple[int, bool, float | None]:
    with Image.open(source) as original:
        if original.format != "PNG" or getattr(original, "n_frames", 1) != 1:
            raise ValueError(f"{source.name}: expected a single-frame PNG")
        has_alpha = "A" in original.getbands() or "transparency" in original.info
        image = original.convert("RGBA" if has_alpha else "RGB")
        metadata = {key: original.info[key] for key in ("icc_profile", "exif", "xmp") if original.info.get(key)}

    data = BytesIO()
    # Alpha is lossless; exact=True also asks the encoder to retain RGB values
    # beneath transparent pixels where the WebP encoder supports it.
    image.save(data, format="WEBP", quality=quality, method=method, alpha_quality=100, exact=True, **metadata)
    result = data.getvalue()
    with Image.open(BytesIO(result)) as decoded:
        decoded.load()
        if decoded.size != image.size:
            raise ValueError(f"{source.name}: encoded dimensions changed")
        decoded = decoded.convert(image.mode)
        alpha_exact = not has_alpha or ImageChops.difference(image.getchannel("A"), decoded.getchannel("A")).getbbox() is None
        if not alpha_exact:
            raise ValueError(f"{source.name}: alpha channel changed")
        difference = ImageChops.difference(image.convert("RGB"), decoded.convert("RGB"))
        mask = image.getchannel("A") if has_alpha else None
        if mask is not None and mask.getbbox() is None:
            psnr = None  # No visible pixels to compare.
        else:
            rms = sqrt(sum(channel * channel for channel in ImageStat.Stat(difference, mask).rms) / 3)
            psnr = float("inf") if rms == 0 else 20 * log10(255 / rms)

    target = source.with_suffix(".webp")
    # Only replace a target after the entire candidate has decoded and passed checks.
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=source.parent, prefix=f".{source.stem}-", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(result)
        temporary.replace(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return len(result), has_alpha, psnr


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=ART_DIR, help="directory containing the PNG sources")
    parser.add_argument("--quality", type=int, default=90, choices=range(0, 101), metavar="0..100")
    parser.add_argument("--method", type=int, default=6, choices=range(0, 7), metavar="0..6")
    parser.add_argument("--only", nargs="+", metavar="FILE.png", help="optional source filenames in --dir")
    args = parser.parse_args()
    if not features.check("webp"):
        raise SystemExit("Pillow was built without WebP support")
    if args.only:
        if any(Path(name).name != name or Path(name).suffix.lower() != ".png" for name in args.only):
            parser.error("--only accepts PNG filenames, not paths")
        sources = [args.dir / name for name in args.only]
    else:
        sources = sorted(p for p in args.dir.iterdir() if p.is_file() and p.suffix.lower() == ".png")
    if not sources:
        raise SystemExit("No PNG files found")
    original_total = 0
    encoded_total = 0
    for source in sources:
        old = source.stat().st_size
        new, has_alpha, psnr = encode(source, args.quality, args.method)
        original_total += old
        encoded_total += new
        psnr_text = "n/a (no visible pixels)" if psnr is None else f"{psnr:.2f} dB"
        print(f"{source.name} -> {source.stem}.webp  {old:,} -> {new:,} bytes  "
              f"saved {100 * (1 - new / old):.1f}%  alpha={'exact' if has_alpha else 'opaque'}  "
              f"visible RGB PSNR={psnr_text}", flush=True)
    print(f"TOTAL {original_total:,} -> {encoded_total:,} bytes; saved {100 * (1 - encoded_total / original_total):.1f}%")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as exc:
        print(f"Conversion failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
