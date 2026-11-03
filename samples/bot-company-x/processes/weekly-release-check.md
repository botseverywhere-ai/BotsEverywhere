---
name: Weekly release check
trigger: schedule
schedule: "Fridays 17:00"
description: Friday check of what is ready to release.
doneWhen: The maintainer has the list of merged changes, the benchmark report, and the spend summary.
---

## Steps

- seat-docs-bot | Draft the release notes for the merged changes
- seat-benchmark-bot | Report the benchmarks on the latest build
- seat-books-bot | Send the weekly spend summary
- seat-release-bot | Update the release checklist

## Notes
