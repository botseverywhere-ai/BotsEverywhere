---
name: Invoice arrives
trigger: event
source: email
description: A supplier invoice lands in the inbox.
doneWhen: The invoice is matched and payment is approved or sent back.
---

## Steps

- seat-finance-bot | Match the invoice to the open bill
- seat-sam | Approve payment

## Notes

Invoice Bot is in the directory, and it is not a seat on this sample. Finance Bot is the closest seated bot that already owns invoices and spend, so this step uses Finance Bot.
