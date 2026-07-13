---
description: Write all prose in ASD-STE100 Simplified Technical English
alwaysApply: true
---

# Prose style: Simplified Technical English (ASD-STE100)

Write all prose in Simplified Technical English (STE). This rule applies to
replies, code comments, docstrings, commit messages, PR text, and documentation.

This rule does not apply to code. Keep identifiers, string literals, quoted
output, and copied text unchanged. The `comments.md` rule decides if a comment
must exist. This rule decides how the comment reads.

## Words

- Give each word one meaning. Use the same word for the same thing every time.
  Do not use synonyms for variety.
- Use each word as one part of speech only. If you use "test" as a noun, do not
  also write "to test". Write "to do a test".
- Prefer the short, common word. Write "use", not "utilize". Write "start", not
  "initiate". Write "about", not "approximately".
- Technical names and technical verbs from the domain are approved. Words such
  as "cache", "serialize", "commit", and "deploy" are correct.
- Write a multi-word noun with three words maximum. Break a longer noun with
  "of" or "in". Write "the timeout of the connection pool", not "the database
  connection pool timeout value".

## Verbs

- Use these forms only:
  - the infinitive ("to install the package")
  - the imperative ("Install the package.")
  - the simple present ("The function returns a list.")
  - the simple past ("The build failed.")
  - the simple future ("The task will start after the merge.")
  - the past participle as an adjective ("the changed files")
- Do not make complex verb constructions with auxiliary verbs. Do not write
  "has been removed", "is running", or "would have failed". Write "we removed
  it", "the server runs", and "it failed".
- Use "can", "must", and "will" for permission, obligation, and future time.
- Use the "-ing" form only in a technical noun or as a modifier. "The logging
  level is 3" is correct. "After adding the flag, run the tests" is not correct.
  Write "Add the flag. Then run the tests."
- Use the active voice. In descriptions, use the passive voice only when the
  agent is unknown.

## Sentences

- Write 20 words maximum in an instruction. Write 25 words maximum in a
  description.
- Keep all parts of the sentence. Do not remove the subject, the verb, or the
  article to make the text short. Write "The function returns the user", not
  "Returns the user".
- Write one instruction in one sentence. Split two actions into two sentences.
- Put the condition before the action. Write "If the file is absent, create it."

## Paragraphs and lists

- Write about one topic in each paragraph.
- Write six sentences maximum in each paragraph.
- Use a vertical list when the text has more than two conditions, parts, or
  steps. A list is clearer than a long sentence.

## Safety and warnings

- Start a warning with the command or the condition. Write "Do not run this on
  the primary database." Do not write an explanation first.
- Put the reason after the command, in a separate sentence.

## Check before you send

- Each sentence is short and has one idea.
- Each verb is in an approved form.
- The voice is active.
- No word does two jobs in the same text.
