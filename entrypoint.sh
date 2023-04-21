#!/bin/bash

# Set default values
DAYS_BEFORE_STALE=${DAYS_BEFORE_STALE:-30}
SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL:-''}
GITHUB_TOKEN=${GITHUB_TOKEN:-''}
GITHUB_REPOSITORY=${GITHUB_REPOSITORY:-''}

# Get the list of stale branches
stale_branches=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/repos/$GITHUB_REPOSITORY/branches?per_page=100" | jq --arg days_before_stale "$DAYS_BEFORE_STALE" '.[] | select(.commit.commit.author.date < (now - ( $days_before_stale | tonumber) * 86400)) | .name')

# Send the message to Slack
if [[ -n "$SLACK_WEBHOOK_URL" && -n "$stale_branches" ]]; then
  message="The following branches are stale:\n\n$stale_branches"
  payload="{\"text\": \"$message\"}"
  curl -X POST -H 'Content-type: application/json' --data "$payload" "$SLACK_WEBHOOK_URL"
fi

