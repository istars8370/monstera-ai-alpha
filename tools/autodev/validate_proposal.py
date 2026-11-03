#!/usr/bin/env python3
"""Treat Codex output as untrusted data. Validate one new test-file patch."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

MAX_JSON = 22000
MAX_PATCH = 15000
MAX_LINES = 120
TEST_PATH = re.compile(r"tests/autodev/[a-z0-9][a-z0-9-]{0,63}\.test\.mjs\Z")


def fail(message: str) -> None:
    print(f"::error::Autodev proposal rejected: {message}", file=sys.stderr)
    raise SystemExit(1)


def output(name: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(f"{name}={value}\n")


def main() -> None:
    raw = os.environ.get("AUTODEV_PROPOSAL", "")
    if not raw or len(raw) > MAX_JSON:
        fail("missing or oversized JSON")

    try:
        proposal = json.loads(raw)
    except json.JSONDecodeError:
        fail("model output is not valid JSON")
    if not isinstance(proposal, dict) or set(proposal) != {
        "summary", "patch", "validation_plan", "risks"
    }:
        fail("unexpected JSON fields")
    if any(not isinstance(value, str) for value in proposal.values()):
        fail("all JSON fields must be strings")
    if any(len(proposal[key]) > 1200 for key in ("summary", "validation_plan", "risks")):
        fail("summary, validation plan, or risk statement is too long")

    patch = proposal["patch"]
    if not patch.strip():
        print("No safe patch proposed; skipping PR.")
        output("has_patch", "false")
        return
    if len(patch) > MAX_PATCH or "\x00" in patch or "\r" in patch:
        fail("patch is too large or contains invalid characters")
    if not patch.endswith("\n"):
        patch += "\n"

    names = re.findall(r"(?m)^diff --git a/(\S+) b/(\S+)$", patch)
    if len(names) != 1 or names[0][0] != names[0][1]:
        fail("patch must add exactly one plain file")
    filename = names[0][0]
    if not TEST_PATH.fullmatch(filename):
        fail("file is outside the isolated tests/autodev/ allowlist")
    if patch.count("new file mode 100644") != 1:
        fail("new regular file mode required")
    if patch.count("--- /dev/null") != 1 or patch.count("+++ b/" + filename) != 1:
        fail("new-file patch markers required")
    if not re.search(r"(?m)^@@ -0,0 \+1,\d+ @@", patch):
        fail("invalid new-file hunk")
    banned = [
        "GIT binary patch", "Binary files ", "new file mode 120000",
        "deleted file mode", "rename from ", "rename to ",
        "copy from ", "copy to ", "Submodule ",
    ]
    if any(token in patch for token in banned):
        fail("binary, symlink, rename, delete, or submodule change forbidden")
    added_lines = sum(
        line.startswith("+") and not line.startswith("+++")
        for line in patch.splitlines()
    )
    if added_lines > MAX_LINES or added_lines < 3:
        fail("source lines must be between 3 and 120")

    patch_file = Path(".autodev.patch")
    patch_file.write_text(patch, encoding="utf-8")
    result = subprocess.run(
        ["git", "apply", "--check", "--", str(patch_file)],
        check=False, capture_output=True, text=True
    )
    if result.returncode:
        fail("git apply --check failed; no branch will be created")

    def clean(value: str) -> str:
        return value.replace("<", "&lt;").replace(">", "&gt;")

    Path(".autodev-body.md").write_text(
        "# MONSTERA Autodev Pilot: review required\n\n"
        "Generated as a *proposed, unexecuted* isolated regression test.\n"
        "No product code was modified and no automated merge is allowed.\n\n"
        f"**Summary:** {clean(proposal['summary'])}\n\n"
        f"**Validation to run independently:** {clean(proposal['validation_plan'])}\n\n"
        f"**Risks:** {clean(proposal['risks'])}\n\n"
        "Control board: https://github.com/istars8370/shah-cat/issues/110\n\n"
        "CEO review and independent test execution are required before merge.\n",
        encoding="utf-8",
    )
    output("has_patch", "true")
    print(f"Static proposal accepted: {filename}, {added_lines} added lines")


if __name__ == "__main__":
    main()
