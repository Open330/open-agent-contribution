**Summary of changes**
- Adds a CI status badge to the top badge row in `README.md`.
- Changes the Node.js badge from `>=24` to `>=22` in `README.md`.
- This diff does not add npm/license badges; those appear to already exist.

**Code quality assessment**
- `High`: `README.md:17` now advertises Node `>=22`, but runtime/tooling still require Node 24:
  - `package.json:6` sets `"node": ">=24.0.0"`.
  - `.github/workflows/ci.yml:27` and `.github/workflows/release.yml:30` use Node 24.
- Impact: documentation is now misleading and can cause users on Node 22/23 to hit install/run failures.
- CI badge URL looks correct and points to an existing workflow (`.github/workflows/ci.yml`).

**Verdict**
- `REQUEST_CHANGES`