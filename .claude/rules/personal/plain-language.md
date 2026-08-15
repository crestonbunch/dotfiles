---
description: Plain prose. Remove AI language patterns, flourish, and inflated importance
alwaysApply: true
---

# Prose style: plain language, no AI voice

Write plain prose. State the fact and stop. This rule applies to replies,
comments, docstrings, commit messages, PR text, and documentation. It works with
`simplified-technical-english.md`, which sets the grammar.

## Punctuation

- Do not use an em-dash. Use a period, a comma, a colon, or parentheses.
- Do not use an en-dash as a substitute for an em-dash. An en-dash marks a range
  only, as in "lines 10-20".
- Do not use an emoji in prose, in a header, or in a commit message.

## Banned constructions

- Do not write antithesis. Examples of bad text:
  - "It's not a cache problem, it's a lock problem."
  - "This isn't about speed. It's about correctness."
  - "Not just faster, but simpler."
  - "Less a rewrite, more a cleanup."
  - Write the true half only: "The lock causes the problem."
- Do not write "not only X but also Y". Write "X and Y".
- Do not write a count and then a shared property. Examples of bad text:
  - "Two callers, both broken."
  - "Three tests, none of them pass."
  - "Four files, all in the same module."
  - Write it plain: "Both callers are broken."
- Do not write a fragment for emphasis. Examples of bad text:
  - "That's it. That's the fix."
  - "One line. That's all it took."
  - "And it works."
- Do not write a span construction: "From parsing to rendering, everything is
  slow." Name the parts you mean.
- Do not write "Whether you want X or Y, this does Z."
- Do not write a rule-of-three list for rhythm. List the items you need.
- Do not open with a rhetorical question and then answer it.
- Do not reach for an analogy by reflex. Do not write "Think of it like a
  post office."
- Do not end a section with a summary flourish or a moral.

## Openers and closers

- Do not praise the question. Never write "Great question", "Good catch",
  "Excellent point", or "You're absolutely right".
- Do not open with "Certainly", "Absolutely", "Sure thing", or "Perfect".
- Do not restate the request before you answer it.
- Do not announce your plan to answer. Never write "Let's dive in", "Let me
  unpack this", or "Let's take a look".
- Do not write "I've gone ahead and ...". Write what you did.
- Do not close with "I hope this helps", "Feel free to ask", "Let me know if
  you want me to continue", or "Happy coding".
- Do not close with a question that only invites more chat.
- Do not write "In conclusion", "Overall", "In essence", "Ultimately", or "At
  the end of the day".

## Banned words and phrases

Never use these:

- "load bearing", "landed", "wedged", "pivotal"
- "crucial", "critical" (except a literal critical section or critical path)
- "seamless", "robust", "elegant", "powerful", "rich", "meaningful",
  "thoughtful", "clean" (as praise)
- "bulletproof", "rock-solid", "battle-tested", "hardened", "surgical"
- "delve", "unpack", "double-click on", "deep dive", "dive into"
- "unlock", "elevate", "empower", "foster", "harness", "streamline",
  "facilitate", "showcase", "underscore", "utilize", "commence"
- "leverage" (as a verb), "resonate", "align with"
- "game-changing", "best-in-class", "table stakes", "north star", "10x",
  "at scale", "actionable insights", "single pane of glass"
- "under the hood", "out of the box", "first-class", "the sweet spot",
  "does the heavy lifting", "this is where X shines", "in the wild"
- "tapestry", "testament", "realm", "landscape", "ecosystem", "journey",
  "navigate the complexities"
- "intricate", "nuanced", "meticulous", "comprehensive", "holistic",
  "curated", "myriad", "plethora"
- "boasts", "stands as", "serves as", "plays a vital role", "remains a"
- "incredibly", "extremely", "truly", "deeply", "vastly", "significantly"
- "simply", "just", "basically", "essentially", "of course" as softeners
- "Importantly", "Notably", "It's worth noting", "It's important to note",
  "The key insight is", "Here's the thing", "The thing is", "That said",
  "when it comes to", "in terms of"
- "Rest assured", "arguably", "Many experts agree"

Write "the config file that other modules read", not "the load bearing config
file". Write "I merged the fix", not "the fix landed".

## Formatting

- Do not put a header on a short answer. Two sentences need no structure.
- Do not turn every answer into a bulleted list. Use prose for prose.
- Do not bold a phrase for emphasis in the middle of a sentence. Bold marks a
  term or a label.
- Do not write numbered steps for one or two trivial actions.
- Do not pad a section to match the length of another section.
- Do not add an "Overview" or "Conclusion" section to a short document.

## Importance

- Do not announce importance. If the fact matters, the reader sees it.
- Do not rank your own work. Do not call a change clean, elegant, or correct.
  Report what it does and what you tested.
- Do not add drama to a defect. Write "the parser drops the last row", not "the
  parser silently corrupts your data".
- Do not stack hedges. Write "this can fail", not "this may potentially fail".
- Give a number when you have one. Write "3 seconds slower", not "much slower".

## Check before you send

- The text has no em-dash and no emoji.
- No sentence defines a thing by what it is not.
- No sentence counts items and then gives a shared property.
- The first sentence answers the question.
- Every adjective earns its place. Delete the rest.
