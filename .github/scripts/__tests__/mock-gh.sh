#!/usr/bin/env bash
# Mock gh CLI for claude-review-api.sh tests. Records each call and prints a canned reply.
#
# Environment:
#   MOCK_GH_LOG      — file that receives one JSON array of arguments per call
#   MOCK_GH_RESPONSE — what to print for the comment lookup in edit-comment
#                      ("<login>\t<issue_url>"); every other call prints "[]" (valid JSON for the page merge)

set -euo pipefail

jq -cn '$ARGS.positional' --args -- "$@" >>"$MOCK_GH_LOG"

# edit-comment looks the comment up (a call without -X) before editing it
if [[ "$*" == *"issues/comments/"* && "$*" != *"-X"* ]]; then
  printf '%b\n' "${MOCK_GH_RESPONSE:-}"
else
  echo "[]"
fi
