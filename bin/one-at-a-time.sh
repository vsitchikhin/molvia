#!/usr/bin/env bash
# Runs a command while holding the one lock every working copy on this machine shares, so the
# heavy checks of several copies take turns instead of starving each other (MOL-139).
#
#   bin/one-at-a-time.sh <label> <command> [args…]
#
# Four pushes at once are four typechecks, four vitest runs and four Playwright runs with their
# browsers on eight cores: the machine swapped, a push took 10–20 minutes instead of about four,
# and a test timed out under the load failed the push, which was then started again into the
# same crowd. In turn, the last of four waits for three short runs and none of them fails.
#
# The lock is `flock`, held by a perl process that runs the command as its child: the kernel
# drops it with that process however it ends, so no run can leave a stale lock behind, and the
# descriptor is closed on exec, so a server the command leaves running does not keep it either.
# Perl because macOS has no `flock(1)`, and it ships with the system.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: bin/one-at-a-time.sh <label> <command> [args…]" >&2
  exit 2
fi

# Already inside the lock: a second take would wait for itself forever.
if [[ -n "${MOLVIA_ONE_AT_A_TIME:-}" ]]; then
  shift
  exec "$@"
fi

lock="${XDG_CACHE_HOME:-$HOME/.cache}/molvia/checks.lock"
mkdir -p "$(dirname "$lock")"

# A run that never ends on its own holds every copy's turn until someone stops it: vitest without
# `run` watches when it is in a terminal, Playwright's `--ui` and `--debug` wait for a person. Refused
# rather than taken — a person types these, and the wait they cause is somebody else's (MOL-162,
# adversarial Л2). `make` and the hooks never pass any of them.
endless=""
for arg in "${@:2}"; do
  case "$arg" in
    --ui | --debug | --watch | -w | watch) endless="$arg" ;;
  esac
done
if [[ -z "$endless" ]] && printf '%s\n' "${@:2}" | grep -qx 'vitest' &&
  ! printf '%s\n' "${@:2}" | grep -qxE 'run|--run'; then
  endless="vitest without run"
fi
if [[ -n "$endless" ]]; then
  echo "one-at-a-time: «${endless}» does not end by itself and would hold every copy's turn —" \
    "use \`npx vitest run …\` and run a watch or a UI outside the lock" >&2
  exit 2
fi

# What a waiting run prints about the one it waits for: the copy by its root, not the folder the run
# was typed in — a module's tests are typed in the module, and «backend» is every copy (Л1).
copy="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")"
label="$copy · $1 · $(git branch --show-current 2>/dev/null || true) · since $(date +%H:%M)"
shift

export MOLVIA_ONE_AT_A_TIME=1
exec perl -e '
  use strict;
  use warnings;
  use Fcntl qw(:flock SEEK_SET);
  use IO::Handle;

  my ($path, $label, @command) = @ARGV;
  open(my $lock, "+>>", $path) or die "one-at-a-time: cannot open $path: $!\n";
  if (!flock($lock, LOCK_EX | LOCK_NB)) {
    seek($lock, 0, SEEK_SET);
    my $holder = <$lock> // "another run\n";
    print STDERR "one-at-a-time: waiting for $holder";
    my $since = time;
    flock($lock, LOCK_EX) or die "one-at-a-time: $!\n";
    my $waited = time - $since;
    printf STDERR "one-at-a-time: waited %dm%02ds\n", $waited / 60, $waited % 60;
  }
  truncate($lock, 0);
  print $lock "$label\n";
  $lock->flush;

  my $status = system { $command[0] } @command;
  exit 127 if $status == -1;
  exit 128 + ($status & 127) if $status & 127;
  exit $status >> 8;
' "$lock" "$label" "$@"
