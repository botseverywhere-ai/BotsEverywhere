---
name: Daily dependency audit
trigger: schedule
schedule: 30 7 * * *
description: Every morning at 07:30, Dependency Verifier reads the project's dependency manifest and checks each dependency against the public advisory sources.
doneWhen: Every dependency in the manifest carries a verdict in the run log, and the unverified ones are named.
---

## Steps

- Dependency Verifier | Read the project's dependency manifest and verify each dependency against the public advisory sources
- Dependency Verifier | Append one verdict line per dependency to the run log, then the summary line
- Owner | Approve any upgrade before it is merged

## Notes

The bot verifies and reports only. It never merges, upgrades, or writes anything but its own log lines.
