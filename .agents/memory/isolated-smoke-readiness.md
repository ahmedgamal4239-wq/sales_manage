---
name: Isolated smoke readiness
description: Why isolated service checks must reject occupied ports before checking health.
---

An isolated integration test must fail before touching its database if any planned service port is already occupied; a successful health response alone does not establish that the test owns the service.

**Why:** Replit development workflows can already occupy common ports. A local smoke run once passed readiness against the existing preview while its own API and Expo processes failed to bind, then attempted authentication against the wrong service.

**How to apply:** In future isolated multi-service checks, reserve or preflight ports before schema setup and service startup, and use distinct configurable ports for local reproduction alongside running previews.