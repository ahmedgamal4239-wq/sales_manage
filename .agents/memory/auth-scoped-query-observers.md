---
name: Auth-scoped query observers
description: Why access transitions should not remove active protected-page queries from the cache.
---

When clearing data after an employee's access scope changes, reset active queries rather than removing them. Do not clear every protected query on the first session lookup after a page reload.

**Why:** A protected route can mount its query observer in the same render as the restored session; removing that query afterward strands the observer, even though the API returns the correct data. Browser sign-in alone did not reveal this, but reloading an authorized page did.

**How to apply:** Check both SPA navigation and full-page refresh on a protected route whenever auth-scoped caches or session transition logic change.