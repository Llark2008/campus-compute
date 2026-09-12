# Worker control page after web rebuild — 2026-09-12

Symptom: local port3001 accepted connections and returned index.html200, but the current `/assets/index-BbvwYB32.js` and `/assets/index-CXEURMHG.css` both returned404. Bootstrap and authenticated local status still worked; Worker was stopped with no task or model process.

Cause: the local control server registered static files with `wildcard:false`, which enumerates file routes at process startup. The previous web build changed hashed asset names while that Worker process continued running, so its route list did not contain the new assets.

Fix: serve the static root with `wildcard:true`, resolving asset paths on request. Existing local Host and API authorization checks remain in place. Restarted only the confirmed stopped local Worker; coordinator and other Workers were unchanged.

Validation:
- Regression reproduces old asset200 → replace index/assets while app stays running → new asset404 before fix.
- After fix, all11 Worker control tests pass, including new JavaScript/CSS200, removed asset404, forged Host403 and protected status403.
- TypeScript check passes.
- Independent scoped code review approved with no findings.
- Live local page, current JavaScript and CSS all return200 after restart.

This fix is included in the updated client archive. A Worker process already running the old code needs one restart to load the fix.
