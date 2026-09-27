# GCS–SSC organization portal connector

This extension connects an agency in GCS–SSC to the companion organization portal through its agency-scoped integration API. The portal keeps organization accounts and original submissions; GCS owns published funding data and imported drafts.

## Health Canada manual-test fixture

Start the companion Portal with its demo seed on `http://localhost:3000/`. Stop the GCS development server before writing its PGlite database, then run from this extension directory:

```bash
bun run seed:demo
```

The first run enables the connector for the existing Health Canada Agency. Start GCS once to apply the enabled extension migrations, stop it, and run `bun run seed:demo` again. The second run caches the three Portal organizations for Health Canada, resolves the existing showcase Agreement and its Proponent by name, and leaves **every organization unverified**. It does not change a GCS core record or create a Portal link. The script is rerunnable and preserves an existing connection.

Set `DATABASE_URL` for a PostgreSQL-backed GCS demo, or `PGLITE_DATA_DIR` if its database is not the root default `.data/pglite`. The Portal URL defaults to `http://localhost:3000/`; override it with `PORTAL_DEMO_URL`. Override the demo Agency code with `PORTAL_DEMO_HEALTH_CANADA_AGENCY_ID` if the companion Portal uses a nonfresh database. The script reads the live Portal organization catalog by name, so its organization IDs may change without breaking the fixture.

Start GCS on a different port (for example `bun run dev --port 3001`). Sign in with the seeded `root@example.com` / `password123` account, which has Agency Manager authority for Health Canada, open **Portal → Health Canada → Connection**, and use these local demo values to exercise **Test connection** and **Save**:

```text
Portal URL: http://localhost:3000/
Portal agency: G-NFAFV
Portal key: gcs_PgdzCAcAAc5UJO42TvnGK8QgSQSv-fWhM-vTd0sfyPo
```

If the Portal Agency ID or token was overridden, enter those same override values. Set `GCS_EXTENSION_SECRETS_KEY` to a stable base64-encoded 32-byte key on the GCS server before saving. On **Organization verification**, Shopify Inc. is an active, unlinked Portal choice for the existing showcase Agreement's Proponent; Northern Community Health Initiative is a second active choice, and Former Health Partnership is inactive. Confirm the link with a note, then inspect and push the queued Agreement from **Portal sync queue**. Select statuses and a pull interval from their respective pages to test those settings. To skip manual connection entry, run the second seed with `GCS_PORTAL_DEMO_PRECONFIGURE=1` and `GCS_EXTENSION_SECRETS_KEY` set; this preconfigures only the connection, not any verification.

## Setup and verification

Install and enable the extension, run its migrations, and set `GCS_EXTENSION_SECRETS_KEY` on the GCS server to a base64-encoded 32-byte value (for example, generate one with `openssl rand -base64 32`). Keep that value stable across restarts: changing it makes stored credentials unreadable. Create an agency integration credential in the portal. In **Agency → Extensions → Organization portal**, save the HTTPS portal URL, `G-` agency code, and one-time key. Loopback HTTP is accepted for local development. The key is encrypted by the host secret store and is never returned to the browser.

Select an existing portal organization and GCS recipient, then explicitly verify the link. Verification queues every current Agreement for that recipient. **Queue initial sync** can enqueue all verified organizations again. Unverified organizations receive no outbound Agreement. Each organization gets its own submission history even when several organizations share one portal Agreement and its authoritative budget.

Agreement and budget changes enqueue further deliveries. The backlog shows attempts, errors, and next retry times. Automatic delivery starts after a short restart grace period, drains small batches, and retries with capped exponential backoff and jitter. Managers can push 1–100 pending items immediately. Delivery reconciles Programs and Streams, one shared Agreement, and per-organization Claim and Forecast sets for each current fiscal year. Program funding is published as `budgetedAmount`; balances remain unknown until an authoritative GCS balance projection exists.

Select which internal Agreement statuses appear in the portal. Other statuses are omitted. Saving the selection queues a refresh for verified organizations. The agency settings also offer a portal update pull interval. The host's Nitro minute task polls the portal on that interval, records discovered events in the inbound inbox, and imports supported items. It leaves failed or unsupported events unacknowledged for retry and staff review.

## Import

**Check for portal updates** imports up to 200 pending events per run under the current staff member's GCS authorization. Scheduled imports use a host-controlled service write path scoped to the enabled agency. Each newly created Claim or Forecast receives the Agreement's current active primary user assignee. Claims and Forecasts with complete mappings are created through atomic host operations, with an extension receipt written in the same transaction. The extension then publishes the GCS reference as the portal item outcome and acknowledges the event. Retrying an ambiguous acknowledgement reuses the receipt and does not create a second draft. Forecasts are separate inactive Drafts, preserving the host's one-active-Forecast-per-Agreement/fiscal-year rule. Unsupported or failed items remain unacknowledged and visible in the inbox.

Agreement balance projection, application intake, attachment transfer, and organization documentation materialization need separate host contracts. The portal retains original submissions and files throughout.

## Form creator

Open **Forms** in the agency's Organization portal workspace after saving a connection. The forms table shows each form's draft or publication status, the current revision, and the Agreements, organizations, or funding opportunities where published revisions appear. Open a row to edit the form, or create a new form. The designer has **Edit**, **Test**, **Settings**, and **Publish** areas. Add pages and nested sections, then add questions to each area. Lists can drive repeatable sections; a repeatable section can contain another list and repeatable subsection at any depth. Select questions can depend on earlier selections, tables collect rows with typed columns, conditions show or hide content, page branches choose a later page, and computed questions interpolate values from source fields. Form introductions, page and section instructions, question help text, choice labels, and table column headings can be authored in both English and French. The **Test** tab previews either language locally without saving responses.

Save a revision before publishing. The **Publish** checklist requires complete English and French content, at least one question, and the latest saved revision. The server checks these translations again before it publishes. Updated revisions do not silently replace previously published ones; the forms table identifies an older published revision as unpublished changes.

The **Publish to portal** section can place a saved form on a verified organization, one Agreement, or the active verified Agreements in a Program or Stream. The optional funding opportunity path uses the selected portal Stream and a deterministic GCS opportunity placeholder until GCS has a native opportunity entity. It publishes one opportunity per form revision; Agreement publication is idempotent for the form revision and Agreement/organization pair. Organizations complete published forms in the portal. The portal retains applications; GCS application intake awaits its own host contract.

Run `bun run typecheck` and `bun run test:unit` in this package. The portal and host run their own checks.

The extension and portal each include the same compiled survey provider under `vendor/survey` so workspace and production installs are self-contained. Its editable source remains in `gcs-ssc-survey`; rebuild there and refresh both vendor copies after a provider change. Replace the copies with a pinned Git release when version 3 is published.
