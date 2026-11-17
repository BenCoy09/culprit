#!/usr/bin/env bash
# Runs kane-cli with the account credentials from environment variables (set them in Render, never in the repo).
exec "${KANE_REAL:-kane-cli}" "$@" --username "$LT_USERNAME" --access-key "$LT_ACCESS_KEY"
