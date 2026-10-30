#!/usr/bin/env python3
"""功能：跨平台编译并执行全部固件原生C++套件和Python回归。
首次编写日期：2026-10-29；变更日期：2026-10-30
修改记录：2026-10-29：首次编写，支持显式CXX及Windows .exe后缀。
- 2026-10-30：加入本机/内网HTTP来源的完整解析与持久记录回归。
- 2026-10-30：加入BLE分片、订阅代际与调度套件。
"""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
SOURCES = ["core", "protocol", "modbus", "rtu", "http", "provisioning", "portal", "ble"]
SUITES = ["core", "protocol", "transports", "http", "http_integration", "reply_drain", "artisan", "provisioning", "portal", "cors", "local_origins", "ble", "ble_adapter"]


def main():
    """功能：运行两种输出模式的真实核心测试及全部Python测试。
    首次编写日期：2026-10-29；变更日期：2026-10-30
    修改记录：2026-10-29：首次编写，任何失败返回非零，不隐藏不支持的平台测试。
    - 2026-10-30：真实BLE适配器使用SDK边界替身编译，覆盖启动与异步队列契约。
    """
    BUILD.mkdir(exist_ok=True)
    compiler = os.environ.get("CXX", "g++")
    flags = ["-std=c++17", "-Iinclude", "-Wall", "-Wextra", "-Wpedantic", "-Werror", "-g"]
    if os.environ.get("SANITIZE") == "1":
        flags += ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
    failed = []
    for mode in (0, 1):
        for suite in SUITES:
            executable = BUILD / (f"test_{suite}_{mode}" + (".exe" if os.name == "nt" else ""))
            adapter = ["-Itests/ble_sdk_stubs", "src/esp_ble.cpp"] if suite == "ble_adapter" else []
            command = [compiler, *flags, *adapter, f"-DROAST_VIRTUAL_DEMO={mode}", f"tests/test_{suite}.cpp", *[f"src/{name}.cpp" for name in SOURCES], "-o", str(executable)]
            result = subprocess.run(command, cwd=ROOT)
            if result.returncode or subprocess.run([str(executable)], cwd=ROOT).returncode:
                failed.append(f"{suite}/{mode}")
    if subprocess.run(["node", "tests/test_setup_page.cjs"], cwd=ROOT).returncode:
        failed.append("setup_page")
    result = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"], cwd=ROOT)
    if result.returncode:
        failed.append("python")
    print("FAILED: " + ", ".join(failed) if failed else "All native and Python suites passed")
    return bool(failed)


if __name__ == "__main__":
    sys.exit(main())
