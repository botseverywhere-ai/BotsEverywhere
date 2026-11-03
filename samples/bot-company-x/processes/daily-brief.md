---
name: Daily brief
trigger: schedule
schedule: "weekdays 08:00"
description: Weekday morning brief for the maintainer.
doneWhen: The brief is ready for the maintainer.
---

## Steps

- seat-issue-bot | List the new issues with their labels
- seat-review-bot | List the open pull requests with their review state
- seat-grok | Send the brief to the maintainer

## Notes
