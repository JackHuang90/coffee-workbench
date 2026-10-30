"""PlatformIO post-build hook: records evaluated SDK flash map, never flashes."""
import json
import hashlib
from pathlib import Path
Import("env")

# Arduino packages carry later language flags in nested lists. Explicitly make
# the evaluated compiler mode C++17 rather than merely requesting an overridden flag.
env.Replace(CXXFLAGS=[str(v) for v in env.Flatten(env.get("CXXFLAGS", []))
                      if not str(v).startswith("-std=")] + ["-std=gnu++17"])

def capture(source, target, env):
    board = env.BoardConfig()
    images = []
    for offset, image in env.get("FLASH_EXTRA_IMAGES", []):
        images.append({"offset": env.subst(str(offset)), "path": env.subst(str(image))})
    images.append({"offset": env.subst("$ESP32_APP_OFFSET"), "path": env.subst("$BUILD_DIR/${PROGNAME}.bin")})
    info = {
        "environment": env.subst("$PIOENV"), "mcu": board.get("build.mcu"),
        "board_id": env.subst("$BOARD"), "board_base_name": board.get("name"),
        "flash_size": board.get("upload.flash_size"), "flash_mode": board.get("build.flash_mode"),
        "image_flash_mode": env.subst("${__get_board_flash_mode(__env__)}"),
        "image_flash_frequency": env.subst("${__get_board_f_image(__env__)}"),
        "flash_frequency_hz": board.get("build.f_flash"),
        "memory_type": board.get("build.arduino.memory_type"), "psram_type": board.get("build.psram_type"),
        "compiler": env.subst("$CXX"),
        "CCFLAGS": [str(v) for v in env.get("CCFLAGS", [])],
        "CXXFLAGS": [str(v) for v in env.get("CXXFLAGS", [])],
        "CPPDEFINES": [str(v) for v in env.get("CPPDEFINES", [])],
        "flash_images": images,
        "physical_outputs_enabled": False,
        "hardware_profile": "UNVERIFIED_CARRIER_REFERENCE_ONLY",
    }
    root = Path(env.subst("$PROJECT_DIR"))
    inputs = [root / "platformio.ini", root / "partitions.csv", root / "tools" / "capture_metadata.py"]
    for directory in (root / "src", root / "include"):
        inputs.extend(p for p in directory.rglob("*") if p.is_file())
    info["build_inputs_sha256"] = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(inputs)}
    path = Path(env.subst("$BUILD_DIR")) / "build_metadata.json"
    path.write_text(json.dumps(info, indent=2) + "\n")

env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", capture)
