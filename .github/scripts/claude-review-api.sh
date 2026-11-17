#!/usr/bin/env bash
set -euo pipefail

# The only GitHub API access the Claude code review gets (.github/workflows/claude-code-review.yml).
# Claude may run this script but not raw `gh api`, which would accept any endpoint and any
# method (POST, PATCH, DELETE). Each subcommand below is one fixed call, always on this PR.
#
# Usage (comment bodies are read from stdin):
#   claude-review-api.sh comments              # all PR comments, every page, as one JSON array
#   claude-review-api.sh review-comments       # all inline review comments, the same way
#   claude-review-api.sh commit <sha>          # prints the full SHA of a commit (fails if missing)
#   claude-review-api.sh post-comment          # adds a PR comment
#   claude-review-api.sh edit-comment <id>     # edits one of the reviewer's own PR comments
#   claude-review-api.sh reply <id>            # replies to an inline review comment on this PR
#
# Environment (set by the workflow, never by Claude):
#   GITHUB_REPOSITORY — owner/repo, set by GitHub Actions on every job
#   PR_NUMBER         — the pull request under review

# The account the review posts as (the job's GITHUB_TOKEN); edits are limited to its comments
readonly REVIEWER_LOGIN="github-actions[bot]"

fail() {
  echo "claude-review-api: $*" >&2
  exit 1
}

REPO="${GITHUB_REPOSITORY:-}"
PR="${PR_NUMBER:-}"
# Fail closed (refuse to run) when the target is missing or malformed, rather than guessing
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "GITHUB_REPOSITORY is missing or invalid"
[[ "$PR" =~ ^[0-9]+$ ]] || fail "PR_NUMBER is missing or invalid"

require_id() {
  [[ "${1:-}" =~ ^[0-9]+$ ]] || fail "expected a numeric comment ID, got '${1:-}'"
}

# Reads the comment body from stdin into BODY; an empty body is almost always a mistake
read_body() {
  BODY=$(cat)
  [ -n "${BODY//[[:space:]]/}" ] || fail "the comment body (stdin) is empty"
}

# Fetches every page and merges them: GitHub returns at most 100 items per page
fetch_all_pages() {
  gh api "$1?per_page=100" --paginate | jq -s 'add // []'
}

SUBCOMMAND="${1:-}"
[ "$#" -gt 0 ] && shift

case "$SUBCOMMAND" in
  comments)
    fetch_all_pages "repos/${REPO}/issues/${PR}/comments"
    ;;
  review-comments)
    fetch_all_pages "repos/${REPO}/pulls/${PR}/comments"
    ;;
  commit)
    [[ "${1:-}" =~ ^[0-9a-f]{7,40}$ ]] || fail "expected a commit SHA (7-40 hex characters), got '${1:-}'"
    gh api "repos/${REPO}/commits/$1" --jq .sha
    ;;
  post-comment)
    read_body
    gh api "repos/${REPO}/issues/${PR}/comments" -X POST -f body="$BODY" --jq .id
    ;;
  edit-comment)
    require_id "${1:-}"
    read_body
    # Only the reviewer's own comments on this PR: never another person's, never another PR's
    OWNER_AND_ISSUE=$(gh api "repos/${REPO}/issues/comments/$1" --jq '[.user.login, .issue_url] | @tsv')
    IFS=$'\t' read -r LOGIN ISSUE_URL <<<"$OWNER_AND_ISSUE"
    [ "$LOGIN" = "$REVIEWER_LOGIN" ] || fail "comment $1 belongs to '${LOGIN}', not ${REVIEWER_LOGIN}"
    [[ "$ISSUE_URL" == */repos/${REPO}/issues/${PR} ]] || fail "comment $1 is not on PR ${PR}"
    gh api "repos/${REPO}/issues/comments/$1" -X PATCH -f body="$BODY" --jq .id
    ;;
  reply)
    require_id "${1:-}"
    read_body
    # GitHub rejects this if the comment isn't an inline review comment on this PR
    gh api "repos/${REPO}/pulls/${PR}/comments/$1/replies" -X POST -f body="$BODY" --jq .id
    ;;
  *)
    fail "unknown subcommand '${SUBCOMMAND}' (expected comments, review-comments, commit, post-comment, edit-comment or reply)"
    ;;
esac
