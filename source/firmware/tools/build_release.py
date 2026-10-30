#!/usr/bin/env python3
"""
功能：离线构建并收集配网参考固件，保留源码溯源、栈预算和校验和；不调用串口或烧录操作。
首次编写日期：未知（历史代码）
变更日期：2026-10-30
修改记录：
- 2026-10-29：兼容 Windows 工具路径，严格验证配网定义并标记硬件未验证的参考构建。
- 2026-10-30：发布清单注明网页只读BLE及其固定UUID，保留未实机验证标记。
"""
import argparse
import ast
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from stack_audit import audit

# 固件项目根目录，作为命令工作目录和溯源路径的基准。
ROOT = Path(__file__).resolve().parents[1]
# 项目独立工具环境和 SDK 缓存目录。
TOOLS = ROOT / ".tools"
# 生成的参考镜像、日志和校验清单目录。
ARTIFACTS = ROOT / "artifacts"
# 允许发布的锁定与虚拟演示构建；不包含仅编译验证环境。
ENVIRONMENTS = ("s3_locked", "s3_virtual_demo")
# 当前系统是否需要 Windows 虚拟环境布局和原生可执行文件后缀。
WINDOWS = os.name == "nt"

def run(args, logfile=None):
    """
    功能：在项目隔离缓存中运行命令并保存 UTF-8 日志，失败时保留退出码。
    首次编写日期：未知（历史代码）
    变更日期：2026-10-29
    修改记录：
    - 2026-10-29：统一 Windows/POSIX 临时目录和日志编码。
    """
    env = os.environ.copy()
    env.update(TMPDIR=str(TOOLS / "tmp"), TMP=str(TOOLS / "tmp"), TEMP=str(TOOLS / "tmp"),
               PLATFORMIO_CORE_DIR=str(TOOLS / "pio"), PIP_CACHE_DIR=str(TOOLS / "cache" / "pip"),
               PYTHONIOENCODING="utf-8")
    proc = subprocess.run([str(x) for x in args], cwd=ROOT, env=env,
                          text=True, encoding="utf-8", errors="replace",
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if logfile:
        logfile.write_text(proc.stdout, encoding="utf-8")
    if proc.returncode:
        print(proc.stdout, file=sys.stderr)
        raise SystemExit(proc.returncode)
    return proc.stdout

def sha(path):
    """
    功能：返回文件原始字节的 SHA256，用于镜像与源码完整性验证。
    首次编写日期：未知（历史代码）
    变更日期：2026-10-29
    修改记录：
    - 2026-10-29：补齐现有函数说明，哈希行为不变。
    """
    return hashlib.sha256(path.read_bytes()).hexdigest()

def validate_release_defines(defines, environment):
    """
    功能：验证实际 SCons 编译定义，要求配网 Wi-Fi 开启、模式精确匹配且不含旧式凭据。
    首次编写日期：2026-10-29
    变更日期：2026-10-29
    修改记录：
    - 2026-10-29：首次编写；支持 metadata 的元组表示与 NAME=value，不接受缺失或冲突值。
    """
    if environment not in ENVIRONMENTS or not isinstance(defines, list):
        raise SystemExit("Unexpected release environment or compile-definition metadata")
    values = {}
    for definition in defines:
        if not isinstance(definition, str):
            raise SystemExit("Unsupported compile-definition metadata; rebuild required")
        if definition.startswith(("(", "[")):
            try:
                pair = ast.literal_eval(definition)
            except (SyntaxError, ValueError):
                raise SystemExit("Malformed compile-definition metadata; rebuild required") from None
            if not isinstance(pair, (tuple, list)) or len(pair) != 2 or not isinstance(pair[0], str):
                raise SystemExit("Unsupported compile-definition metadata; rebuild required")
            name, value = pair
        else:
            name, separator, value = definition.partition("=")
            if not separator:
                value = None
        values.setdefault(name, []).append(str(value) if value is not None else None)
    # Never include the rejected value in diagnostics: it may contain credentials.
    if any(name in values for name in ("ROAST_WIFI_SSID", "ROAST_WIFI_PASSWORD")):
        raise SystemExit("Release refuses embedded Wi-Fi credential definitions; use device provisioning")
    expected = {"ROAST_WIFI_ENABLE": "1", "ROAST_VIRTUAL_DEMO": "0" if environment == "s3_locked" else "1"}
    for name, value in expected.items():
        if name not in values or any(actual != value for actual in values[name]):
            raise SystemExit(f"Release requires unambiguous {name}={value} in {environment}")

def sdk_executable(path):
    """
    功能：选择当前系统的 SDK 可执行文件，缺失时停止，不回退到 PATH 中的未知工具。
    首次编写日期：2026-10-29
    变更日期：2026-10-29
    修改记录：
    - 2026-10-29：首次编写，支持 Windows .exe 和 POSIX 原始文件名。
    """
    executable = path.with_name(path.name + ".exe") if WINDOWS else path
    if not executable.is_file():
        raise SystemExit(f"Missing SDK executable: {executable}")
    return executable

def main():
    """
    功能：构建或收集两个配网参考镜像，核验输入和栈预算，离线合并并生成完整性清单。
    首次编写日期：未知（历史代码）
    变更日期：2026-10-30
    修改记录：
    - 2026-10-29：使用 Python 模块启动 PlatformIO，验证 Wi-Fi=1 且无本地凭据，记录配网及未验证硬件状态。
    - 2026-10-30：记录默认编入的只读网页BLE能力，Artisan仍为Wi-Fi Modbus TCP。
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--collect-only", action="store_true", help="collect already verified builds without invoking compiler")
    args = parser.parse_args()
    if (ROOT / "include" / "local_config.h").exists():
        raise SystemExit("Release collection refuses local_config.h: use first-boot provisioning, never embedded credentials.")
    for directory in (TOOLS / "tmp", TOOLS / "cache", ARTIFACTS):
        directory.mkdir(parents=True, exist_ok=True)
    python = TOOLS / "venv" / ("Scripts/python.exe" if WINDOWS else "bin/python")
    if not python.is_file():
        raise SystemExit("Install tools per docs/build-and-flash.md first.")
    pio = [python, "-m", "platformio"]
    if not args.collect_only:
        for environment in (*ENVIRONMENTS, "s3_network_compilecheck"):
            print(f"Clean-building {environment}", flush=True)
            run([*pio, "run", "-e", environment, "-t", "clean"], ARTIFACTS / f"{environment}-clean.log")
            run([*pio, "run", "-e", environment], ARTIFACTS / f"{environment}-build.log")
    manifest = {
        "created_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "firmware_kind": "NEW_REBUILD_NOT_RESTORED",
        "physical_outputs_enabled": False,
        "board_confirmed": False,
        "hardware_tested": False,
        "network_configuration": "FIRST_BOOT_SOFTAP_PROVISIONING",
        "web_ble": {
            "enabled": True,
            "read_only": True,
            "stack": "BUNDLED_ARDUINO_3.3.12_NIMBLE",
            "service_uuid": "b4e7a001-9d56-4f1b-a6e0-7d31c2f84590",
            "status_uuid": "b4e7a002-9d56-4f1b-a6e0-7d31c2f84590",
            "hardware_tested": False,
        },
        "credential_policy": "NO_LOCAL_CONFIG_OR_WIFI_CREDENTIAL_DEFINES",
        "warning": "First-boot hotspot provisioning; reference N16R8 configuration only. Not hardware-tested or a qualified roasting controller.",
        "git_commit": run(["git", "rev-parse", "HEAD"]).strip(),
        "git_status": run(["git", "status", "--porcelain"]).splitlines(),
        "platformio": run([*pio, "--version"]).strip(),
        "environments": {},
    }
    run([*pio, "pkg", "list"], ARTIFACTS / "installed-packages.txt")
    packages = TOOLS / "pio" / "packages"
    package_metadata = {}
    for package in sorted(packages.iterdir()):
        metadata = package / "package.json"
        if metadata.exists():
            package_metadata[package.name] = json.loads(metadata.read_text(encoding="utf-8"))
    (ARTIFACTS / "package-metadata.json").write_text(json.dumps(package_metadata, indent=2) + "\n", encoding="utf-8")
    toolchain = packages / "toolchain-xtensa-esp-elf" / "bin"
    compiler = sdk_executable(toolchain / "xtensa-esp32s3-elf-g++")
    objdump = sdk_executable(toolchain / "xtensa-esp32s3-elf-objdump")
    readelf = sdk_executable(toolchain / "xtensa-esp32s3-elf-readelf")
    manifest["compiler_version"] = run([compiler, "--version"]).splitlines()[0]
    esptool = sdk_executable(packages / "tool-esptool" / "esptool")
    for environment in ENVIRONMENTS:
        build = ROOT / ".pio" / "build" / environment
        dest = ARTIFACTS / environment
        dest.mkdir(exist_ok=True)
        metadata = json.loads((build / "build_metadata.json").read_text(encoding="utf-8"))
        validate_release_defines(metadata.get("CPPDEFINES"), environment)
        stack_report = audit(build, objdump)
        (dest / "stack-audit.json").write_text(json.dumps(stack_report, indent=2) + "\n", encoding="utf-8")
        if not stack_report["passed"]:
            raise SystemExit(f"Stack-frame budget failed in {environment}")
        if not metadata.get("build_inputs_sha256"):
            raise SystemExit("Rebuild required: binary has no build-input provenance")
        current_inputs = [ROOT / "platformio.ini", ROOT / "partitions.csv", ROOT / "tools" / "capture_metadata.py"]
        for directory in (ROOT / "src", ROOT / "include"):
            current_inputs.extend(p for p in directory.rglob("*") if p.is_file())
        current_hashes = {p.relative_to(ROOT).as_posix(): sha(p) for p in sorted(current_inputs)}
        if current_hashes != metadata["build_inputs_sha256"]:
            raise SystemExit(f"Rebuild required: {environment} source/build-input set changed")
        # Guard against collecting images for accidental memory or mode changes.
        if metadata["mcu"] != "esp32s3" or metadata["flash_size"] != "16MB" or metadata["memory_type"] != "qio_opi":
            raise SystemExit(f"Unexpected reference build configuration: {metadata}")
        mode = "0" if environment == "s3_locked" else "1"
        flash_map = []
        for entry in metadata["flash_images"]:
            source = Path(entry["path"])
            if not source.is_absolute():
                source = ROOT / source
            name = "application.bin" if source.name == "firmware.bin" else source.name
            shutil.copy2(source, dest / name)
            flash_map.append({"offset": entry["offset"], "file": name, "sha256": sha(dest / name)})
        shutil.copy2(build / "firmware.elf", dest / "application.elf")
        run([readelf, "-h", dest / "application.elf"], dest / "elf-header.txt")
        shutil.copy2(build / "build_metadata.json", dest / "build_metadata.json")
        (dest / "flash-map.json").write_text(json.dumps(flash_map, indent=2) + "\n", encoding="utf-8")
        for image in ("application.bin", "bootloader.bin"):
            run([esptool, "--chip", "esp32s3", "image-info", dest / image], dest / f"{image}-image-info.txt")
        # Merge offline from exactly the evaluated SDK offsets. No port argument, no erase/efuses.
        merge = [esptool, "--chip", "esp32s3", "merge-bin", "--output", dest / "reference-merged.bin",
                 "--flash-mode", metadata["image_flash_mode"], "--flash-freq", metadata["image_flash_frequency"], "--flash-size", metadata["flash_size"]]
        for image in flash_map:
            merge.extend((image["offset"], dest / image["file"]))
        run(merge, dest / "merge.log")
        manifest["environments"][environment] = {"mode": "LOCKED" if mode == "0" else "VIRTUAL_DEMO", "wifi_enabled": True,
             "provisioning_enabled": True, "reference_build": True, "hardware_tested": False,
             "flash_map": flash_map, "files": {p.name: {"bytes": p.stat().st_size, "sha256": sha(p)} for p in sorted(dest.iterdir()) if p.is_file()}}
    network_build = ROOT / ".pio" / "build" / "s3_network_compilecheck"
    if network_build.exists():
        network_stack = audit(network_build, objdump)
        (ARTIFACTS / "network-compilecheck-stack-audit.json").write_text(json.dumps(network_stack, indent=2) + "\n", encoding="utf-8")
        if not network_stack["passed"]:
            raise SystemExit("Stack-frame budget failed in networking compile-check")
    # Bind every readable source file, including uncommitted new rebuild files, to this artifact set.
    excluded = {".tools", ".pio", "artifacts", "build", "__pycache__"}
    source_hashes = {}
    for source in sorted(ROOT.rglob("*")):
        if source.is_file() and not any(part in excluded for part in source.relative_to(ROOT).parts):
            source_hashes[source.relative_to(ROOT).as_posix()] = sha(source)
    manifest["source_files_sha256"] = source_hashes
    manifest["source_snapshot_sha256"] = hashlib.sha256(json.dumps(source_hashes, sort_keys=True).encode()).hexdigest()
    (ARTIFACTS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    files = sorted(p for p in ARTIFACTS.rglob("*") if p.is_file() and p.name != "SHA256SUMS")
    (ARTIFACTS / "SHA256SUMS").write_text("".join(f"{sha(p)}  {p.relative_to(ARTIFACTS).as_posix()}\n" for p in files), encoding="utf-8")
    print(f"Collected two non-actuating reference images at {ARTIFACTS}")

if __name__ == "__main__":
    main()
