# GCS–SSC organization portal connector

This extension connects an agency in GCS–SSC to the companion organization portal through its agency-scoped integration API. The portal keeps organization accounts and original submissions; GCS owns published funding data and imported drafts.

## Setup and verification

Install and enable the extension, run its migrations, and set `GCS_EXTENSION_SECRETS_KEY` on the GCS server to a base64-encoded 32-byte value (for example, generate one with `openssl rand -base64 32`). Keep that value stable across restarts: changing it makes stored credentials unreadable. Create an agency integration credential in the portal. In **Agency → Extensions → Organization portal**, save the HTTPS portal URL, `G-` agency code, and one-time key. Loopback HTTP is accepted for local development. The key is encrypted by the host secret store and is never returned to the browser.

Select an existing portal organization and GCS recipient, then explicitly verify the link. Verification queues every current Agreement for that recipient. **Queue initial sync** can enqueue all verified organizations again. Unverified organizations receive no outbound Agreement. Each organization gets its own submission history even when several organizations share one portal Agreement and its authoritative budget.

Agreement and budget changes enqueue further deliveries. The backlog shows attempts, errors, and next retry times. Automatic delivery starts after a short restart grace period, drains small batches, and retries with capped exponential backoff and jitter. Managers can push 1–100 pending items immediately. Delivery reconciles Programs and Streams, one shared Agreement, and per-organization Claim and Forecast sets for each current fiscal year. Program funding is published as `budgetedAmount`; balances remain unknown until an authoritative GCS balance projection exists.

Select which internal Agreement statuses appear in the portal. Other statuses are omitted. Saving the selection queues a refresh for verified organizations. The agency settings also offer a portal update pull interval. The host's Nitro minute task polls the portal on that interval, records discovered events in the inbound inbox, and imports supported items. It leaves failed or unsupported events unacknowledged for retry and staff review.

## Import

**Check for portal updates** imports up to 200 pending events per run under the current staff member's GCS authorization. Scheduled imports use a host-controlled service write path scoped to the enabled agency. Each newly created Claim or Forecast receives the Agreement's current active primary user assignee. Claims and Forecasts with complete mappings are created through atomic host operations, with an extension receipt written in the same transaction. The extension then publishes the GCS reference as the portal item outcome and acknowledges the event. Retrying an ambiguous acknowledgement reuses the receipt and does not create a second draft. Forecasts are separate inactive Drafts, preserving the host's one-active-Forecast-per-Agreement/fiscal-year rule. Unsupported or failed items remain unacknowledged and visible in the inbox.

Agreement balance projection, application intake, attachment transfer, and organization documentation materialization need separate host contracts. The portal retains original submissions and files throughout.

## Form creator

Open **Form creator** in the agency's Organization portal settings after saving a connection. Create a bilingual form, add pages and nested sections, then add questions to each area. Lists can drive repeatable sections; a repeatable section can contain another list and repeatable subsection at any depth. Select questions can depend on earlier selections, tables collect rows with typed columns, conditions show or hide content, page branches choose a later page, and computed questions interpolate values from source fields. The **Test** tab runs the form locally without saving responses. Save a revision before publishing; an updated revision does not silently replace a previously published one.

The **Publish** tab can attach the saved form to an existing, verified Agreement or publish it with a provisional funding opportunity. The opportunity path uses the selected portal Stream and a deterministic GCS opportunity placeholder until GCS has a native opportunity entity. It publishes one opportunity per form revision; Agreement publication is idempotent for the form revision and Agreement/organization pair. Organizations complete the published form in the portal. The portal retains applications; GCS application intake awaits its own host contract.

Run `bun run typecheck` and `bun run test:unit` in this package. The portal and host run their own checks.

The extension and portal each include the same compiled survey provider under `vendor/survey` so workspace and production installs are self-contained. Its editable source remains in `gcs-ssc-survey`; rebuild there and refresh both vendor copies after a provider change. Replace the copies with a pinned Git release when version 3 is published.
