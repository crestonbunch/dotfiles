---
description: Deep vs. shallow modules (Ousterhout, A Philosophy of Software Design)
alwaysApply: true
---

# Module design: prefer deep modules

- Favor **deep modules**: a simple interface hiding a substantial, complex
  implementation. The best modules give a lot of functionality behind a small
  interface. Avoid **shallow modules**, whose interface is nearly as complex as
  their implementation and thus provide little abstraction for the cost they add.
- Achieve depth through **information hiding** (Parnas): each module encapsulates
  a few pieces of knowledge, which represent design decisions. That knowledge
  lives in the module's implementation but does **not** appear in its interface,
  so it stays invisible to other modules. The less a module exposes, the deeper
  it is. Watch for the inverse, **information leakage**, where a design decision
  is reflected in multiple modules and couples them together.
- Do **not** decompose by the runtime order of operations. Temporal
  decomposition (a module per step: read, then process, then write) leaks
  information across modules and produces shallow modules.
- Instead, decompose by **knowledge**: identify the distinct pieces of knowledge
  needed to carry out the application's tasks, and design each module to
  encapsulate one or a few of those pieces. This yields a clean, simple design
  with deep modules.
