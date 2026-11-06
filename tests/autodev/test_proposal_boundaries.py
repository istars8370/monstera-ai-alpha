"""Offline boundary regression tests for the existing proposal validator.

Run: python3 -m unittest discover -s tests/autodev -p 'test_*.py' -v
Uses temporary repositories only; generated proposal code is never executed.
"""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "proposal_test_helpers", ROOT / "tools/autodev/test_validate_proposal.py"
)
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


class ProposalBoundaryTests(unittest.TestCase):
    setUp = helpers.ProposalValidatorTests.setUp
    tearDown = helpers.ProposalValidatorTests.tearDown
    check = helpers.ProposalValidatorTests.check

    def assert_decision(self, proposal, accepted):
        result = self.check(proposal)
        if accepted:
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("has_patch=true", self.output.read_text())
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertFalse(self.output.exists(), "rejected input emitted a gate result")
            self.assertFalse((self.root / ".autodev-body.md").exists())
        self.assertFalse((self.root / helpers.GOOD_PATH).exists())

    def test_accepts_exactly_120_source_lines(self):
        self.assert_decision(helpers.payload(self.patch_with_lines(120)), True)

    def test_rejects_121_source_lines(self):
        self.assert_decision(helpers.payload(self.patch_with_lines(121)), False)

    def test_rejects_two_source_lines(self):
        self.assert_decision(helpers.payload(self.patch_with_lines(2)), False)

    @staticmethod
    def patch_with_lines(count):
        prefix = helpers.new_file_patch().split("@@", 1)[0]
        return prefix + f"@@ -0,0 +1,{count} @@\n" + "+// fixture only\n" * count

    def test_accepts_metadata_at_1200_characters(self):
        proposal = json.loads(helpers.payload(helpers.new_file_patch()))
        for field in ("summary", "validation_plan", "risks"):
            proposal[field] = "x" * 1200
        self.assert_decision(json.dumps(proposal), True)

    def test_rejects_each_oversized_metadata_field(self):
        for field in ("summary", "validation_plan", "risks"):
            with self.subTest(field=field):
                proposal = json.loads(helpers.payload(helpers.new_file_patch()))
                proposal[field] = "x" * 1201
                self.assert_decision(json.dumps(proposal), False)

    def test_rejects_non_string_fields(self):
        for field in ("summary", "patch", "validation_plan", "risks"):
            with self.subTest(field=field):
                proposal = json.loads(helpers.payload(helpers.new_file_patch()))
                proposal[field] = None
                self.assert_decision(json.dumps(proposal), False)


if __name__ == "__main__":
    unittest.main()
