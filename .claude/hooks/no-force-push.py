#!/usr/bin/env python3
"""Blocks every force push and every amend of a commit that is already pushed. No exceptions.

The owner's absolute rule: a published branch is never rewritten. Exit code 2 refuses the Bash call
and hands the reason back to Claude.
"""
import json
import re
import subprocess
import sys

data = json.load(sys.stdin)
command = (data.get("tool_input") or {}).get("command") or ""
cwd = data.get("cwd") or None


def refuse(reason: str) -> None:
    print(
        f"ЗАПРЕЩЕНО: {reason}. Форс-пуш и переписывание запушенной истории запрещены владельцем "
        "без исключений. Исправление — новым коммитом, актуализация — мержем, обычный git push.",
        file=sys.stderr,
    )
    sys.exit(2)


for segment in re.split(r"&&|\|\||;|\n|\|", command):
    words = segment.split()
    if "git" not in words:
        continue
    rest = words[words.index("git") + 1 :]
    # Skip global options such as `-C dir` before the subcommand.
    while rest and rest[0].startswith("-"):
        rest = rest[2:] if rest[0] in ("-C", "-c") else rest[1:]
    if not rest:
        continue
    sub, args = rest[0], rest[1:]
    if sub == "push":
        if any(
            a in ("-f", "--force", "--force-with-lease", "--force-if-includes", "--mirror")
            or a.startswith("--force")
            or (a.startswith("-") and not a.startswith("--") and "f" in a[1:])
            or a.startswith("+")
            or ":+" in a
            for a in args
        ):
            refuse("git push с форсом")
        if "--delete" in args or "-d" in args or any(a.startswith(":") for a in args):
            refuse("удаление ветки на сервере пушем")
    if sub == "commit" and "--amend" in args:
        try:
            pushed = subprocess.run(
                ["git", "branch", "-r", "--contains", "HEAD"],
                capture_output=True, text=True, cwd=cwd, timeout=10,
            ).stdout.strip()
        except Exception:
            pushed = "unknown"
        if pushed:
            refuse("git commit --amend коммита, который уже на сервере")
    if sub == "rebase":
        try:
            upstream = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "@{u}"],
                capture_output=True, text=True, cwd=cwd, timeout=10,
            ).returncode == 0
        except Exception:
            upstream = True
        if upstream:
            refuse("rebase опубликованной ветки")

sys.exit(0)
