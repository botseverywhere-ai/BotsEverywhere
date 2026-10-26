/**
 * Paste this into any AI with the organization file template (Connect bots, Option 4), after filling in the blanks. The
 * organization already exists, so the AI reads what the owner gives it, asks only about gaps, and waits for a yes before
 * it writes the file. docs/organization-file.md and the template's instructions carry the same text.
 */
export const ORG_FILE_PROMPT = `I want to bring my organization into BotsEverywhere, an open source tool that runs a team of bots in Grok Bot. My organization already exists: I want its structure as it is today, with its departments, its people, and who reports to whom. These instructions come with the BotsEverywhere organization file template (organization.json): attached, pasted, or the file you are reading. Read its readme and fields: they are the rules for the file.

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
- Put your assumptions and notes in your reply, not in the file. Write them first, then the file: as a file named botseverywhere-organization.json if you can, otherwise the JSON alone in one code block.`
