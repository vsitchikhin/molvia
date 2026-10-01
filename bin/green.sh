#!/usr/bin/env bash
# Remembers which checks passed on which tree, so the same tree is not checked twice (MOL-139).
#
#   bin/green.sh record <step>…   after the steps passed: remember them for this tree
#   bin/green.sh has <step>       exits 0 if the step already passed on this very tree
#
# The Definition of Done runs `make check`, and the push used to run typecheck and test again on
# the tree `make check` had just passed; a push rejected by the remote ran all of it once more.
#
# A tree is the commit's content, `HEAD^{tree}`, and only a clean working tree is that content —
# untracked files included, since vitest would run a test file git does not know. So a step is
# recorded, and trusted, only when `git status` is empty. The marks live in this worktree's own
# git directory, never shared with another copy: its `.env` and its database are its own.
#
# A tree that differs from the green one only in documents is green too (MOL-164): no check reads a
# `.md`, `docs/` or `.claude/`, and a task often ends with a commit of its rules after the code.

set -euo pipefail

usage() {
  echo "usage: bin/green.sh record <step>… | bin/green.sh has <step>" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
action=$1
shift

marks=$(git rev-parse --git-path molvia-green)
if [[ -n $(git status --porcelain) ]]; then
  tree=
else
  tree=$(git rev-parse 'HEAD^{tree}')
fi

case "$action" in
  record)
    [[ -n $tree ]] || exit 0
    mkdir -p "$marks"
    for step in "$@"; do
      printf '%s\n' "$tree" >"$marks/$step"
    done
    ;;
  has)
    [[ $# -eq 1 && -n $tree && -f "$marks/$1" ]] || exit 1
    green=$(<"$marks/$1")
    [[ $green == "$tree" ]] && exit 0
    git cat-file -e "$green^{tree}" 2>/dev/null || exit 1
    # Both names of a rename, so a file moved into `docs/` is still a file taken away. Read whole
    # before grep: `grep -q` leaving early would kill `git diff` with SIGPIPE, and under `pipefail`
    # the negated pipeline would then say green.
    changed=$(git diff --no-renames --name-only "$green" "$tree")
    ! grep -qvE '(\.md$|^docs/|^\.claude/)' <<<"$changed"
    ;;
  *) usage ;;
esac
