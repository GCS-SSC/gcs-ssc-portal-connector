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

Select an existing portal organization and GCS recipient, then explicitly verify the link. Verification queues every current Agreement for that recipient. **Queue initial sync** can enqueue all verified organizations again. Unverified organizations receive no outbound Agreement. Each organization gets its own submission history even when several organizations share one portal Agreement and its authoritative budget. Claim exports carry an explicit `claim.applicantRecipientId`, frozen from that organization’s published Agreement link. The importer derives the host Claim’s submitting Proponent from the Agency’s verified organization identity and requires both the Claim identity and retained Agreement reference to match it. A missing identity, alternate Proponent, or removed Agreement relationship leaves the item pending without creating a Claim or acknowledging the event.

Agreement and budget changes enqueue further deliveries. The backlog shows attempts, errors, and next retry times. Automatic delivery starts after a short restart grace period, drains small batches, and retries with capped exponential backoff and jitter. Managers can push 1–100 pending items immediately. Delivery reconciles Programs and Streams, one shared Agreement, and per-organization Claim and Forecast sets for each current fiscal year. Program funding is published as `budgetedAmount`; balances remain unknown until an authoritative GCS balance projection exists.

Select which internal Agreement statuses appear in the portal. Other statuses are omitted. Saving the selection queues a refresh for verified organizations. The agency settings also offer a portal update pull interval. The host's Nitro minute task polls the portal on that interval, records discovered events in the inbound inbox, and imports supported items. It leaves failed or unsupported events unacknowledged for retry and staff review.

Forms can be designed before a Portal connection is configured. **Create form** opens a details modal on the Forms list for the bilingual name and optional introduction, with one field per row. Submitting it creates a local draft record and opens its designer only after the save succeeds. A draft without questions is not yet a Portal survey; its first valid saved revision enters the Portal operation queue. The form detail hero displays those values with the shared status badge, and places **Edit details** and **Save revision** together in its actions. The designer has Edit, Flow, Test, and Publish views, followed by compact, expandable Pages & Sections navigation in the same left sidebar. Flow has its own full-width route diagram; selecting a page returns to its editor. Page and section details, question settings, and page navigation use the review schema editor's section headings and accordions, with fields editable directly in the page. The host supplies the hero, modal, fields, buttons, workspace, review section layout, and accordions through the public extension UI SDK.

## Import

**Check for portal updates** imports up to 200 pending events per run under the current staff member's GCS authorization. Scheduled imports use a host-controlled service write path scoped to the enabled agency. Each newly created Claim or Forecast receives the Agreement's current active primary user assignee. Claims and Forecasts with complete mappings are created through atomic host operations, with an extension receipt written in the same transaction. The extension then publishes the GCS reference as the portal item outcome and acknowledges the event. Retrying an ambiguous acknowledgement reuses the receipt and does not create a second draft. Forecasts are separate inactive Drafts, preserving the host's one-active-Forecast-per-Agreement/fiscal-year rule. Unsupported or failed items remain unacknowledged and visible in the inbox.

Funding applications published from a GCS Funding Opportunity now import through the host's atomic Intake operation. In **Portal delivery → Intake imports**, explicitly select an active Health Canada/owning-Agency administrative group with a current member. The setting is persisted as the connector's Agency configuration `intakeGroupId`; the importer revalidates the group through the host each time. Unverified organizations, missing groups, unmapped Portal-owned intakes, source conflicts and numeric ID collisions remain pending and unacknowledged.

All forms in one submitted application map to one Intake with the complete immutable export; each Portal item keeps its own receipt and returns the same host Intake reference. The numeric external application ID is a generated positive bigint surrogate derived from the configured Portal URL/agency namespace and submission code; the original opaque Portal code remains in source evidence. Keep that connection identity stable for retries. Failed acknowledgements safely reuse the committed receipt.

Other forms published on verified organizations, Agreements, Programs and Streams are retained as durable extension delivery evidence. **Recent deliveries** displays the submission code, bilingual form title and a stable `portal-receipt:<id>` reference. The eye action renders frozen submitted answers read-only. Their original form revisions remain readable after later publications change. Receipt lists stay thin; a single agency-authorized detail request retrieves each export.

Original ready attachments in received form/application evidence can be downloaded through the agency-scoped receipt view. The connector retrieves the private Portal file with its server-side credential and verifies its original size and SHA-256 before returning a forced download. The Portal retains the original files. Copying attachment bytes into host attachment storage, Agreement balance projection and organization documentation materialization still need separate host contracts.

## Form creator

Open **Forms** in the agency's Organization portal workspace, even before configuring a Portal connection. Creating a form saves a local draft record immediately; complete revisions enter the Portal sync queue. They remain editable while the Portal is unreachable and synchronize after a connection is configured. Publishing waits until the saved revision has reached the Portal. The forms table shows each form's draft or publication status, the current revision, and the Agreements, organizations, or funding opportunities where published revisions appear. Open a row to edit the form, or create a new form. The designer has **Edit**, **Flow**, **Test**, and **Publish** areas, with nested Pages & Sections navigation below them in the left sidebar. **Flow** presents the page routes on its own screen. The hero's **Edit details** action opens the form name and introduction modal. Add pages and nested sections, then add questions to each area. Lists can drive repeatable sections; a repeatable section can contain another list and repeatable subsection at any depth. Select questions can depend on earlier selections, tables collect rows with typed columns, conditions show or hide content, page branches choose a later page, and computed questions interpolate values from source fields. Form introductions, page and section instructions, question help text, choice labels, and table column headings can be authored in both English and French. The **Test** tab previews either language locally without saving responses.

Save a revision before publishing. The **Publish** checklist requires complete English and French content, at least one question, and the latest saved, synchronized revision. The server checks these translations again before it publishes. Updated revisions do not silently replace previously published ones; the forms table identifies an older published revision as unpublished changes.

The **Publish to portal** section can place a saved other form on a verified organization, one Agreement, or the active verified Agreements in a Program or Stream. Agreement publication is idempotent for the form revision and Agreement/organization pair.

Open **Intakes** in the agency Portal workspace to create an intake opportunity in a synced GCS Stream. Give it bilingual names and opening/closing dates, then create its application form inside the draft intake. Saving a revision attaches that exact revision to the intake. Publish the intake after the form is complete in both languages; the portal then lists the opportunity and exposes its attached form to eligible organization users. Publication pins the revision. Withdraw before editing the opportunity or saving and attaching a new form revision. An unused draft can be deleted; its form remains in the Forms library. Older opportunities published through the former form-first path remain visible in Intakes. Portal-owned intakes remain pending unless they carry a supported mapped GCS Funding Opportunity identity. Use the GCS Funding Opportunity Portal forms tab for applications that must become GCS Intakes.

Intake detail edits carry the loaded call revision. A concurrent edit returns a conflict, reloads the latest details for comparison, and preserves the staff member's draft until they explicitly continue against the new revision. Once an application has been submitted, the Portal refuses to change that call's attached forms, even after withdrawal. Editing the underlying survey may create a new revision, but the call and earlier submissions keep the pinned revision.

GCS Funding Opportunities have a **Portal forms** tab. Staff with the opportunity's Transfer Payment Contributor access can create up to ten forms under the opportunity, reorder or remove them while unpublished, and publish once its agency status is active and every form passes the bilingual readiness check. The connector creates or reconciles a portal funding call with the GCS opportunity ID as its foreign identity. Portal applicants complete every attached form in one application. Publication pins each saved revision; withdraw before changing forms. Viewers can read the attached forms. Existing portal-owned Intakes remain separate from GCS Funding Opportunities.

Run `bun run typecheck` and `bun run test:unit` in this package. The portal and host run their own checks.

The extension and portal each include the same compiled survey provider under `vendor/survey` so workspace and production installs are self-contained. Its editable source remains in `gcs-ssc-survey`; rebuild there and refresh both vendor copies after a provider change. Replace the copies with a pinned Git release when version 3 is published.

## Ready-to-test local seed

Launch the companion Portal on port **3003**, then run `bun run dev:clean` in GCS.
The first GCS request initializes Health Canada's enabled connector, localhost
connection and encrypted public demo API credential. The **Forms** library starts
with **Community health project plan / Plan de projet de santé communautaire**, a
four-page bilingual form with all 14 provider types, nested repeating sections,
conditional questions, page branching, dependent selections, calculated values,
tables, budgets, activities and attachments. Open it and use **Test** immediately.
Its saved revision automatically enters the normal Portal sync queue; delivery
starts after the worker's short startup grace. If the Portal starts later, the
queued form retries automatically. It appears in the Portal survey designer after
sync; publication to an organization or intake uses the existing Publish workflow.

Existing connections and edited forms survive restarts. `GCS_PORTAL_DEMO_SEED=0`
disables automatic initialization, and production processes never initialize this
local fixture. Override `PORTAL_DEMO_URL`, `PORTAL_DEMO_HEALTH_CANADA_AGENCY_ID`
or `PORTAL_DEMO_HEALTH_CANADA_TOKEN` for a different local companion configuration.
