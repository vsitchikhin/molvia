# trivy for the release and the daily scan (MOL-369, owner's В-1 «а»): an official image pinned by its tag
# and digest, kept in a Dockerfile of its own so that Dependabot's `images` moves it and
# `bin/check-pins.mjs` holds it. Nothing of ours is built here: the workflow builds it and runs it.
FROM ghcr.io/aquasecurity/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb AS runtime

# The runner's own uid: the cache of the vulnerability database and the report are written into its
# workspace.
USER 1001
