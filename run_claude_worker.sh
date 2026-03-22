#!/bin/bash
set -e

REPO_DIR="$1"
TASK_PROMPT="$2"

cd "$REPO_DIR"
claude -p "$TASK_PROMPT"
