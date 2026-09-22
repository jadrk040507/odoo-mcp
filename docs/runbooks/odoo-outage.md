# Odoo outage

Confirm elevated `tenant_unreachable`, `upstream_timeout`, or `rate_limited` events without inspecting business payloads. Pause write confirmations if responses are ambiguous; writes are never retried automatically. Tell users reads may be retried after recovery and ambiguous writes must be checked in Odoo. Validate recovery with connection health and one bounded read. Roll back only if evidence points to the gateway release rather than Odoo.
