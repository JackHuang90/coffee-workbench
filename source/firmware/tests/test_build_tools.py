import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from stack_audit import parse_frames

class StackAuditTests(unittest.TestCase):
    def test_real_xtensa_entry_formats(self):
        text = """00000000 <roast::Controller::begin(char const*)>:
   0: 207036 entry a1, 0x2070
00000000 <setup()>:
   0: 008136 entry a1, 64
"""
        self.assertEqual([x["bytes"] for x in parse_frames(text, "core.o")], [8304, 64])
        self.assertEqual(parse_frames(text, "core.o")[0]["function"], "roast::Controller::begin(char const*)")

    def test_no_false_pass_from_non_instruction(self):
        self.assertEqual(parse_frames("literal entrypoint\n entry a2, 32", "x.o"), [])

if __name__ == "__main__":
    unittest.main()
