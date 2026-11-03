#!/usr/bin/env python3
"""Offline unit tests for the untrusted Codex patch validator."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

VALIDATOR = Path(__file__).with_name("validate_proposal.py")
GOOD_PATH = "tests/autodev/pilot-check.test.mjs"


def new_file_patch(path: str = GOOD_PATH, mode: str = "100644") -> str:
    return (
        f"diff --git a/{path} b/{path}\n"
        f"new file mode {mode}\n"
        "--- /dev/null\n"
        f"+++ b/{path}\n"
        "@@ -0,0 +1,3 @@\n"
        "+import test from 'node:test';\n"
        "+import assert from 'node:assert/strict';\n"
        "+test('example', () => assert.equal(1, 1));\n"
    )


def payload(patch: str) -> str:
    return json.dumps({
        "summary": "New isolated regression test proposal",
        "patch": patch,
        "validation_plan": "node --test tests/autodev/pilot-check.test.mjs",
        "risks": "The test has not been executed.",
    })


class ProposalValidatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.work = tempfile.TemporaryDirectory()
        self.root = Path(self.work.name)
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        self.output = self.root / "gh-output"

    def tearDown(self) -> None:
        self.work.cleanup()

    def check(self, proposal: str) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["AUTODEV_PROPOSAL"] = proposal
        env["GITHUB_OUTPUT"] = str(self.output)
        return subprocess.run(
            [sys.executable, str(VALIDATOR)],
            cwd=self.root, env=env, capture_output=True, text=True, check=False
        )

    def test_accepts_one_new_test_file(self) -> None:
        result = self.check(payload(new_file_patch()))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("has_patch=true", self.output.read_text())
        self.assertIn("diff --git", (self.root / ".autodev.patch").read_text())
        self.assertTrue((self.root / ".autodev-body.md").exists())

    def test_no_change_is_safe(self) -> None:
        result = self.check(payload(""))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("has_patch=false", self.output.read_text())
        self.assertFalse((self.root / ".autodev.patch").exists())

    def test_blocks_workflow_changes(self) -> None:
        result = self.check(payload(new_file_patch(".github/workflows/evil.yml")))
        self.assertNotEqual(result.returncode, 0)

    def test_blocks_symlink_mode(self) -> None:
        result = self.check(payload(new_file_patch(mode="120000")))
        self.assertNotEqual(result.returncode, 0)

    def test_blocks_multiple_files(self) -> None:
        result = self.check(payload(new_file_patch() + new_file_patch("tests/autodev/other.test.mjs")))
        self.assertNotEqual(result.returncode, 0)

    def test_blocks_existing_files(self) -> None:
        path = self.root / GOOD_PATH
        path.parent.mkdir(parents=True)
        path.write_text("already here\n")
        result = self.check(payload(new_file_patch()))
        self.assertNotEqual(result.returncode, 0)

    def test_blocks_unexpected_fields(self) -> None:
        invalid = json.loads(payload(new_file_patch()))
        invalid["extra"] = "not in schema"
        result = self.check(json.dumps(invalid))
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
