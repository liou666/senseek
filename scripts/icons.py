"""Sync the approved Senseek icons and their manifest cache keys."""
from pathlib import Path
from subprocess import run

root = Path(__file__).resolve().parent.parent
run(["node", str(root / "scripts" / "sync-icons.mjs")], check=True)
