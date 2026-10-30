#!/usr/bin/env bash
# 功能：编译并执行两种固件模式的原生与门户脚本/Python回归。
# 首次编写日期：未知（历史代码）；变更日期：2026-10-30
# 修改记录：2026-10-30：加入本机/内网HTTP来源套件，保留既有失败即停语义。
# - 2026-10-30：加入BLE协议及订阅调度套件。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
CXX="${CXX:-g++}"
flags=(-std=c++17 -Iinclude -Wall -Wextra -Wpedantic -Werror -g)
if [[ "${SANITIZE:-0}" == 1 ]]; then flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer -fno-pie -no-pie); fi
sources=(src/core.cpp src/protocol.cpp src/modbus.cpp src/rtu.cpp src/http.cpp src/provisioning.cpp src/portal.cpp src/ble.cpp)
for mode in 0 1; do
  for suite in core protocol transports http http_integration reply_drain artisan provisioning portal cors local_origins ble ble_adapter; do
    adapter=()
    if [[ "$suite" == ble_adapter ]]; then adapter=(-Itests/ble_sdk_stubs src/esp_ble.cpp); fi
    "$CXX" "${flags[@]}" "${adapter[@]}" -DROAST_VIRTUAL_DEMO="$mode" "tests/test_${suite}.cpp" "${sources[@]}" -o "build/test_${suite}_${mode}"
    "build/test_${suite}_${mode}"
  done
done
node tests/test_setup_page.cjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
