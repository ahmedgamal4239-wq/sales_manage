---
name: Secret refresh checks
description: Handling operator-supplied secrets when a runtime repeatedly fails validation after secret updates.
---

Secret-presence checks and user confirmation do not establish that a newly submitted secret satisfies the application's policy in the executing runtime. Do not weaken validation or repeatedly run a one-time setup after the same precondition fails; stop and request a verified secret update or runtime refresh.

**Why:** Multiple confirmed updates to a manager-bootstrap password still failed the existing minimum-length check, including in freshly launched processes. It was not possible to distinguish a still-short stored value from an environment refresh issue without exposing the secret.

**How to apply:** Check only non-sensitive validity signals, never print the value. Keep one-time setup idempotent and leave imported accounts pending until the credential passes validation. If the same check fails again, explain the blocked state and have the operator update the secret and restart the project environment before retrying.