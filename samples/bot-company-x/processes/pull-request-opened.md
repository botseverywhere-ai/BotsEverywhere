---
name: Pull request opened
trigger: manual
description: A contributor opens a pull request.
doneWhen: The pull request is merged or sent back with a review.
---

## Steps

- seat-security-bot | Scan the diff for secrets and risky dependencies
- seat-review-bot | Run the tests and draft the review
- seat-benchmark-bot | Run the agent benchmarks on the branch
- seat-sam | Approve the merge

## Notes
