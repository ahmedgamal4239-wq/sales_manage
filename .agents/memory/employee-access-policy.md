---
name: Employee access policy
description: The agreed relationship between job roles, assignments, and individual access restrictions.
---

Individual permission choices restrict what the employee's role already allows; they must never add privileges beyond the role or expand the employee's assigned data scope. A null individual policy inherits the role's defaults, while an empty policy grants no actions.

**Why:** The user explicitly chose both roles/assignments and custom permissions; using an additive override would let a narrow role bypass its intended limits.

An employee allowed to manage accounts may grant only permissions they themselves hold. This applies to role-default access, account creation, self-edits, existing account edits, and password resets.

**Why:** Without a grant ceiling, a restricted manager could create an unrestricted manager or reset a more privileged account's password and bypass their restrictions.

**How to apply:** Keep authorization on the server and calculate effective access there. New controls and clients should show that result, not infer authority from the role name alone. Treat access edits as both a target role-ceiling check and an actor grant-ceiling check.

For customer data specifically, higher management may see all customers; employees and agents should see only customers assigned to them.

**Why:** The user explicitly confirmed this distinction when requesting customer-level access and offline payment records.

**How to apply:** Enforce customer ownership in API reads and writes, including payment records and their private photos; hiding unrelated customers in the UI alone is insufficient.