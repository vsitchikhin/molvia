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

# What a waiting run prints about the one it waits for.
label="$(basename "$PWD") · $1 · $(git branch --show-current 2>/dev/null || true) · since $(date +%H:%M)"
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
