# gitleaks for CI (MOL-369, owner's В-1 «а»): an official image pinned by its tag and digest, kept in a
# Dockerfile of its own so that Dependabot's `images` moves it and `bin/check-pins.mjs` holds it — a
# `docker run` of a workflow neither reads. Nothing of ours is built here: CI builds it and runs it.
FROM ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f AS runtime

# The runner's own uid: the checkout is its, so git reads it as the owner's.
USER 1001
