# Organization file

Connect bots → Step 2 → **Option 4: Import an existing organization .json (describe your organization to an LLM)** brings in an organization that already exists: its departments, its people, and who reports to whom. Option 2 builds bots from an idea through an interview; Option 4 starts from what the organization already is.

**Download organization file template** gives `organization.json` (`public/organization-file-template.json`): a `readme`, an `instructions` list that is the prompt below line for line, a `fields` guide, and a Northwind example with two founders at the top and analysts who report to both. The import skips `readme`, `instructions`, and `fields`.

**Import organization file** reads the file the AI writes, shows a preview, and waits for **Import**. Nothing is written before that.

## Paste this into any AI

Fill in the blanks first. Leave out what you don't have: the AI asks for it.

```text
I want to bring my organization into BotsEverywhere, an open source tool that runs a team of bots in Grok Bot. My organization already exists: I want its structure as it is today, with its departments, its people, and who reports to whom. These instructions come with the BotsEverywhere organization file template (organization.json): attached, pasted, or the file you are reading. Read its readme and fields: they are the rules for the file.

Here is what I know. Blanks are fine. If these lines are still blank, ask me to fill them in first.

Organization name:
Website(s):
Social media:
Description:
People (name, job title, department, what they do, who they report to):
Which of these people am I:

Don't interview me from zero. Read the website and the social media pages if you can open them, and tell me which ones you could not open. Then ask me only about what is missing or unclear, a few questions at a time, such as someone's job title or department, or who someone reports to.

Then show me the structure as a short list: each person with their job title, department, and who they report to. Wait for my OK or my changes. Don't write the file until I confirm.

When I confirm, write the file:
- Use exactly the template's format, with the example organization replaced by mine.
- Fill in organization from what I told you and what you read: description, purpose, industry, and size.
- List every person once, with their real name. Never invent people, names, job titles, emails, or phone numbers.
- Several people can be at the top, such as founders, owners, or partners: leave their reportsTo out.
- Everyone else reports to another person in the file, by their exact name. When someone reports to more than one person, list them all, the main one first.
- Set you to my name, exactly as in people.
- Leave out any field you don't know.
- Put your assumptions and notes in your reply, not in the file. Write them first, then the file: as a file named botseverywhere-organization.json if you can, otherwise the JSON alone in one code block.
```

## File

One JSON object. Only `organization`, `departments`, `people`, and `you` are read.

```json
{
  "organization": {
    "name": "Northwind",
    "description": "A small advisory firm that values businesses for owners who plan to sell, buy, or bring in a partner.",
    "purpose": "Give every owner a clear, defensible value for their business.",
    "industry": "Financial services",
    "size": "6 people"
  },
  "departments": ["Leadership", "Valuations"],
  "people": [
    { "name": "Ada Moreno", "title": "Co-founder and CEO", "department": "Leadership" },
    { "name": "Ben Carter", "title": "Co-founder and Partner", "department": "Leadership" },
    { "name": "Chloe Park", "title": "Financial analyst", "department": "Valuations", "reportsTo": ["Ada Moreno", "Ben Carter"], "owns": ["The financial analysis in each valuation report"] }
  ],
  "you": "Chloe Park"
}
```

- **organization**: `description`, `purpose`, `industry`, and `size` fill the organization fields. The organization keeps the name it was created with; `name` is for the AI.
- **departments**: names. A department named only on a person is added too. A person without one sits in General.
- **people**: `name` (required, unique in the file), `title`, `department`, `reportsTo`, `owns` (a list), and `email`, `phone`, `location`, `about` when known.
- **reportsTo**: left out for the people at the top. Several people can be at the top: founders, owners, or partners. Otherwise one name, or a list of names with the main one first. The org chart draws the main one as a solid line and the rest as dotted lines (Also reports to).
- **you**: the name of the person importing, exactly as in `people`. That person's seat becomes You. Without it, You stays at the top beside the people.

## Import rules

- Only into an organization that has just You, and the Connector's seat when Step 1 came first. Anything else and Option 4 shows `ORG_IMPORT_LOCKED`, and `POST /api/orgs/<slug>/org-file` answers 409.
- People don't lock bot imports. After Option 4, Option 1 and Option 2 still work, and a bot can report to any person by their exact name.
- A manager who is not in the file, a person who reports to themself, or a reporting loop puts that person at the top with a note. A person without a name, or a second person with the same name, is skipped.
- Names match without regard to case or accents. File names drop accents: José Núñez is `seats/jose-nunez.md`.
- Like the bots file, the import accepts a byte-order mark, Windows line endings, and a whole AI reply saved as `.json` with the file in one `json` code block.
