#!/usr/bin/env python3
"""Inspect actual Xtensa application object frames; this is not a whole-call-path proof."""
import argparse
import json
from pathlib import Path
import re
import subprocess

LIMIT = 2048

def parse_frames(disassembly, object_name):
    frames = []
    function = None
    for line in disassembly.splitlines():
        label = re.match(r"^[0-9a-fA-F]+ <(.+)>:$", line)
        if label:
            function = label.group(1)
        entry = re.search(r"\bentry\s+a1,\s*(0x[0-9a-fA-F]+|[0-9]+)\b", line)
        if entry:
            frames.append({"object": object_name, "function": function,
                           "bytes": int(entry.group(1), 0)})
    return frames

def audit(build, objdump):
    frames = []
    objects = sorted((build / "src").rglob("*.o"))
    if not objects:
        raise ValueError(f"No application object files under {build / 'src'}")
    for obj in objects:
        output = subprocess.check_output([str(objdump), "-Cd", str(obj)], text=True)
        frames.extend(parse_frames(output, obj.relative_to(build).as_posix()))
    if not frames:
        raise ValueError("No Xtensa entry frames found; cannot silently pass audit")
    frames.sort(key=lambda row: row["bytes"], reverse=True)
    return {"limit_per_function_bytes": LIMIT, "max_frame_bytes": frames[0]["bytes"],
            "passed": all(frame["bytes"] <= LIMIT for frame in frames),
            "scope": "Compiled application src objects only; not SDK stack use, total call path, interrupt load or on-board high-water-mark measurement.",
            "objects": [p.relative_to(build).as_posix() for p in objects], "frames": frames}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("build", type=Path)
    p.add_argument("objdump", type=Path)
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    result = audit(args.build, args.objdump)
    rendered = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered)
    else:
        print(rendered, end="")
    if not result["passed"]:
        raise SystemExit("Application function exceeds 2048-byte stack-frame budget")

if __name__ == "__main__":
    main()
