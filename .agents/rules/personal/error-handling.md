---
description: Error design and recovery; John Ousterhout
alwaysApply: true
---

# Error handling

Goal: fewer exceptional cases for callers to handle.

- **Define errors out of existence.** Choose useful semantics, e.g. idempotent deletion. API design, not blanket conversion of failures to empty results. Respect established contracts; absence is normal only when the contract permits it.
- **Mask through recovery.** Recover locally while fulfilling the contract, e.g. fetch from a backup after server failure. Swallowing an exception or reporting false success is not recovery.
- **Aggregate.** Common handling for failures with a common response. Examples: server-crash recovery handles several failure types; RPC errors reported at wait rather than separately at send.
- **Consider the caller.** Before reporting an error, identify the caller's useful response. If none, reconsider the API or handling boundary; don't merely pass complexity upward.
- **Stop when recovery is unviable.** Report to an appropriate top-level handler or terminate when continued execution is unsafe. No invented recovery.
- **Keep diagnostics.** Useful failure context in the error or system log.

Sources: Ousterhout, *A Philosophy of Software Design*, ch. 10; [CS 190 notes](https://web.stanford.edu/~ouster/cgi-bin/cs190-spring15/lecture.php?topic=errorHandling). Operational paraphrases; recovery and termination qualifications verified against the author's notes.
