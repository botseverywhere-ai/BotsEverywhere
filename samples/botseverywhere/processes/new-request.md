---
name: New request
trigger: event
source: form
description: Someone sends a new request.
doneWhen: The request has an owner.
---

## Steps

- seat-product-bot | Classify the request
- seat-miguel | Receive the request

## Notes

Request Bot is in the directory, and it is not a seat on this sample. Product Bot is the closest seated bot, so it classifies the request and Miguel receives it.
