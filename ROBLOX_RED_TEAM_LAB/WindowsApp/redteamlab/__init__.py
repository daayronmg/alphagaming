"""ROBLOX RED TEAM LAB - control & reporting core.

This package is the *management and reporting* layer of the lab. It does NOT
interact with the Roblox process, inject code, manipulate memory, or touch
Hyperion. Its job is to:

  * define reproducible security test *scenarios* (as data),
  * ingest result logs produced by the Luau self-test harness that runs inside
    the operator's own authorized Roblox experience,
  * evaluate those results into PASS / FAIL / INCONCLUSIVE / PENDING,
  * score risk, and
  * generate JSON / CSV / HTML reports.

The actual exercise of defenses happens server-side inside the operator's own
experience (see ../../RobloxModules). See Documentation/LIMITATIONS.md.
"""

__version__ = "1.0.0"
APP_NAME = "ROBLOX RED TEAM LAB"
