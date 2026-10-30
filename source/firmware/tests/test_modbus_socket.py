#!/usr/bin/env python3
"""功能：使用真实回环 socket 验证生产控制器及 Modbus，兼容 Windows/POSIX。
首次编写日期：未知（历史代码）
变更日期：2026-10-29
修改记录：
- 2026-10-29：Windows 链接 Winsock；有界线程读取启动端口，替代仅 POSIX 支持的管道 select。

No ESP, serial port, LAN host, Artisan installation, or physical output is used.
The DEMO fixture explicitly grants local USB virtual control for verification; shipping
firmware never auto-arms. Run from any directory: python3 path/to/this_file.py.
"""
from contextlib import contextmanager
import os
from pathlib import Path
import queue
import socket
import struct
import subprocess
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"


def compile_servers():
    """功能：构建两个固件模式的回环测试服务。
    首次编写日期：未知（历史代码）；变更日期：2026-10-29。
    修改记录：2026-10-29：Windows 使用 .exe 扩展名并链接 ws2_32。
    """
    BUILD.mkdir(exist_ok=True)
    for mode in (0, 1):
        subprocess.run([
            os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra", "-Werror",
            f"-DROAST_VIRTUAL_DEMO={mode}", f"-I{ROOT / 'include'}",
            str(ROOT / "tests/modbus_socket_server.cpp"),
            str(ROOT / "src/core.cpp"), str(ROOT / "src/modbus.cpp"), str(ROOT / "src/protocol.cpp"),
            "-o", str(BUILD / f"modbus_socket_{mode}{'.exe' if os.name == 'nt' else ''}"),
        ] + (["-lws2_32"] if os.name == "nt" else []), check=True)


@contextmanager
def server(mode, grant="power"):
    """功能：启动隔离服务，有界等待端口，并在用例退出时回收进程。
    首次编写日期：未知（历史代码）；变更日期：2026-10-29。
    修改记录：2026-10-29：用队列和单次读取线程兼容 Windows 管道，保留三秒超时。
    """
    process = subprocess.Popen([str(BUILD / f"modbus_socket_{mode}{'.exe' if os.name == 'nt' else ''}"), grant], stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True)
    greeting = queue.Queue(maxsize=1)
    reader = threading.Thread(target=lambda: greeting.put(process.stdout.readline()), daemon=True)
    reader.start()
    try:
        try:
            line = greeting.get(timeout=3).strip()
        except queue.Empty as error:
            raise AssertionError("loopback fixture did not report listening port") from error
        if not line.startswith("PORT "):
            raise AssertionError(f"bad fixture greeting: {line!r}")
        port = int(line.split()[1])
        if not 0 < port < 65536:
            raise AssertionError(f"fixture did not bind an ephemeral loopback port: {port}")
        yield port
    finally:
        process.terminate()
        reader.join(timeout=3)
        _, err = process.communicate(timeout=3)
        if err:
            raise AssertionError(err)


def connect(port):
    return socket.create_connection(("127.0.0.1", port), timeout=2)


def request(transaction, function, address, value, unit=1):
    return struct.pack(">HHHBBHH", transaction, 0, 6, unit, function, address, value)


def exact(stream, size):
    value = bytearray()
    while len(value) < size:
        chunk = stream.recv(size - len(value))
        if not chunk:
            raise AssertionError("truncated Modbus response")
        value.extend(chunk)
    return bytes(value)


def response(stream, transaction):
    header = exact(stream, 7)
    tid, protocol, length, unit = struct.unpack(">HHHB", header)
    assert tid == transaction and protocol == 0 and unit == 1
    assert 2 <= length <= 254
    return exact(stream, length - 1)


def transact(stream, transaction, function, address, value):
    stream.sendall(request(transaction, function, address, value))
    return response(stream, transaction)


def registers(pdu):
    assert pdu[0] == 3 and pdu[1] == len(pdu) - 2
    return struct.unpack(">" + "H" * (pdu[1] // 2), pdu[2:])


class SocketIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compile_servers()

    def test_status_bt_et_and_explicit_demo_identity(self):
        for mode in (0, 1):
            with self.subTest(mode=mode), server(mode) as port, connect(port) as stream:
                flags, state, _, version = registers(transact(stream, 1, 3, 4, 4))
                self.assertTrue(flags & 8)  # physical lock in both images
                self.assertEqual(bool(flags & 0x8000), bool(mode))
                self.assertEqual(state, 9 if mode else 0)  # test fixture ARTISAN_POWER vs LOCKED
                self.assertEqual(version, 1)
                pdu = transact(stream, 2, 3, 0, 2)
                if mode:
                    bt, et = struct.unpack(">hh", pdu[2:])
                    self.assertEqual(pdu[:2], b"\x03\x04")
                    self.assertTrue(250 <= bt <= 3000 and 250 <= et <= 3000)
                else:
                    self.assertEqual(pdu, b"\x83\x04")  # unavailable, never fabricated zero

    def test_stop_same_controller_and_reject_unknown_control_register(self):
        for mode in (0, 1):
            with self.subTest(mode=mode), server(mode) as port, connect(port) as stream:
                initial = transact(stream, 10, 6, 102, 800)
                self.assertEqual(initial, b"\x06\x00\x66\x03\x20" if mode else b"\x86\x04")
                self.assertEqual(registers(transact(stream, 1, 3, 3, 1))[0], 800 if mode else 0)
                self.assertEqual(transact(stream, 2, 6, 0, 100), b"\x86\x02")
                self.assertEqual(registers(transact(stream, 3, 3, 3, 1))[0], 800 if mode else 0)
                stopped = transact(stream, 4, 6, 100, 0)
                self.assertEqual(stopped, b"\x06\x00\x64\x00\x00" if mode else b"\x86\x04")
                self.assertEqual(registers(transact(stream, 5, 3, 3, 1))[0], 0)
                flags, state = registers(transact(stream, 6, 3, 4, 2))
                self.assertFalse(flags & 2)
                self.assertEqual(state, 1 if mode else 0)
                self.assertEqual(transact(stream, 7, 6, 100, 1), b"\x86\x03")

    def test_virtual_power_fan_owner_and_bounds(self):
        with server(1) as port, connect(port) as stream:
            self.assertEqual(transact(stream, 1, 6, 102, 650), b"\x06\x00\x66\x02\x8a")
            self.assertEqual(transact(stream, 2, 6, 103, 300), b"\x06\x00\x67\x01\x2c")
            self.assertEqual(registers(transact(stream, 3, 3, 3, 1)), (650,))
            fan, owner, mode, remaining = registers(transact(stream, 4, 3, 8, 4))
            self.assertEqual((fan, owner, mode), (300, 3, 1))
            self.assertTrue(290 <= remaining <= 300)
            self.assertEqual(transact(stream, 5, 6, 102, 1001), b"\x86\x03")
            self.assertEqual(transact(stream, 6, 6, 101, 1800), b"\x86\x04")
            self.assertEqual(transact(stream, 7, 6, 104, 1), b"\x06\x00\x68\x00\x01")
            self.assertEqual(registers(transact(stream, 8, 3, 3, 1)), (650,))

    def test_sv_owns_one_local_pid_and_rejects_power_mode(self):
        with server(1, "sv") as port, connect(port) as stream:
            self.assertEqual(transact(stream, 1, 6, 101, 1800), b"\x06\x00\x65\x07\x08")
            self.assertEqual(registers(transact(stream, 2, 3, 2, 1)), (1800,))
            self.assertEqual(transact(stream, 3, 6, 102, 500), b"\x86\x04")
            self.assertEqual(transact(stream, 4, 6, 103, 400), b"\x06\x00\x67\x01\x90")
            time.sleep(0.05)
            self.assertGreater(registers(transact(stream, 5, 3, 3, 1))[0], 0)
            self.assertEqual(registers(transact(stream, 6, 3, 9, 2)), (4, 2))
            self.assertEqual(transact(stream, 7, 6, 101, 65536 - 100), b"\x06\x00\x65\xff\x9c")
            self.assertEqual(struct.unpack(">h", transact(stream, 8, 3, 2, 1)[2:]), (-100,))

    def test_without_local_usb_grant_all_artisan_outputs_rejected(self):
        for mode in (0, 1):
            with self.subTest(mode=mode), server(mode, "none") as port, connect(port) as stream:
                for transaction, address, value in ((1, 101, 1800), (2, 102, 600), (3, 103, 400), (4, 104, 1)):
                    self.assertEqual(transact(stream, transaction, 6, address, value), b"\x86\x04")
                self.assertEqual(registers(transact(stream, 5, 3, 3, 1)), (0,))
                self.assertEqual(registers(transact(stream, 6, 3, 8, 2)), (0, 0))

    def test_read_only_traffic_cannot_keep_virtual_output_alive(self):
        with server(1) as port, connect(port) as stream:
            transact(stream, 1, 6, 102, 700)
            transact(stream, 2, 6, 103, 400)
            deadline = time.monotonic() + 5.3
            transaction = 10
            while time.monotonic() < deadline:
                time.sleep(0.4)
                transact(stream, transaction, 3, 4, 4)
                transaction += 1
            self.assertEqual(registers(transact(stream, 80, 3, 3, 1)), (0,))
            self.assertEqual(registers(transact(stream, 81, 3, 8, 2)), (0, 0))
            self.assertEqual(transact(stream, 82, 6, 102, 700), b"\x86\x04")
            flags, state = registers(transact(stream, 83, 3, 4, 2))
            self.assertTrue(flags & 4)
            self.assertEqual(state, 8)

    def test_fragmented_and_pipelined_frames(self):
        for mode in (0, 1):
            with self.subTest(mode=mode), server(mode) as port, connect(port) as stream:
                data = request(51, 3, 4, 4) + request(52, 3, 4, 4)
                for offset in range(0, len(data), 3):
                    stream.sendall(data[offset:offset + 3])
                self.assertEqual(registers(response(stream, 51))[-1], 1)
                self.assertEqual(registers(response(stream, 52))[-1], 1)

    def test_bad_protocol_and_unit_close_without_response(self):
        for mode in (0, 1):
            with self.subTest(mode=mode), server(mode) as port:
                for malformed in (b"\x00\x01\x00\x01\x00\x06", request(1, 3, 4, 1, unit=2)):
                    with connect(port) as stream:
                        stream.sendall(malformed)
                        self.assertEqual(stream.recv(1), b"")

    def test_truncated_frame_expires_without_fabricated_reply(self):
        for mode in (0, 1):
            with self.subTest(mode=mode), server(mode) as port, connect(port) as stream:
                stream.sendall(request(1, 3, 4, 4)[:5])
                self.assertEqual(stream.recv(1), b"")  # server's production TcpFramer expires at 1 s

    def test_invalid_range_and_quantity_exceptions(self):
        for mode in (0, 1):
            with self.subTest(mode=mode), server(mode) as port, connect(port) as stream:
                self.assertEqual(transact(stream, 1, 3, 11, 2), b"\x83\x02")
                self.assertEqual(transact(stream, 2, 3, 4, 0), b"\x83\x03")
                self.assertEqual(transact(stream, 3, 3, 0, 13), b"\x83\x03")


if __name__ == "__main__":
    unittest.main(verbosity=2)
