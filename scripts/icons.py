"""Sync the approved Senseek icons, including the optically adjusted 16px export."""
from pathlib import Path
from shutil import copyfile

root = Path(__file__).resolve().parent.parent
source = root / "assets" / "senseek"
destination = root / "extension" / "icons"
destination.mkdir(parents=True, exist_ok=True)
copyfile(source / "senseek-icon.svg", destination / "mark.svg")
for size in (16, 32, 48, 128):
    copyfile(source / "exports" / f"icon-{size}.png", destination / f"icon-{size}.png")
