import { readdirSync, readFileSync } from 'node:fs'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { Pool } from 'pg'
import { expect, it } from 'vitest'
import extension from '../extension.config.ts'

it('builds only extension-prefixed tables with untruncated database identifiers', async () => {
  const connectionString = process.env.PORTAL_NAMING_DATABASE_URL
  const connection = new Kysely<unknown>({ dialect: connectionString
    ? new PostgresDialect({ pool: new Pool({ connectionString }) }) : new KyselyPGlite().dialect })
  const db = await connection.startTransaction().execute()
  try {
    const hostFixture = `CREATE SCHEMA extensions;
      CREATE TABLE "Agency_Profile" (id bigint PRIMARY KEY);
      CREATE TABLE "Applicant_Recipient_Profile" (id bigint PRIMARY KEY);
      CREATE TABLE "Funding_Case_Agreement_Profile" (id bigint PRIMARY KEY);
      CREATE TABLE "Funding_Case_Agreement_Budget_Fiscal_Year" (id bigint PRIMARY KEY);
      CREATE TABLE "Funding_Case_Agreement_Budget_Line_Item" (id bigint PRIMARY KEY);
      CREATE TABLE "Funding_Case_Agreement_Budget_Version" (id bigint PRIMARY KEY);
      CREATE TABLE "Funding_Case_Agreement_Applicant_Recipient" (id bigint PRIMARY KEY);
      CREATE TABLE "Funding_Case_Agreement_Claim" (id bigint PRIMARY KEY, egcs_fc_status bigint);
      CREATE TABLE "Funding_Case_Agreement_Forecast" (id bigint PRIMARY KEY, egcs_fc_status bigint);
      CREATE TABLE "Funding_Case_Intake_Profile" (id bigint PRIMARY KEY, egcs_fi_status bigint);
      CREATE TABLE "Common_Status" (id bigint PRIMARY KEY, egcs_cn_name_en text,
        egcs_cn_name_fr text, egcs_cn_color text, _deleted boolean)`
    for (const statement of hostFixture.split(';')) await sql.raw(statement).execute(db)

    const migrationsDirectory = new URL('../server/migrations/', import.meta.url)
    const explicitConstraints = new Set<string>()
    for (const file of readdirSync(migrationsDirectory).sort()) {
      const source = readFileSync(new URL(file, migrationsDirectory), 'utf8')
      for (const match of source.matchAll(/\b(?:CONSTRAINT|INDEX)\s+([a-z_][a-z_0-9]*)/gi)) {
        expect(Buffer.byteLength(match[1]!), `${file}: ${match[1]}`).toBeLessThanOrEqual(63)
      }
      for (const match of source.matchAll(/\bCONSTRAINT\s+([a-z_][a-z_0-9]*)/gi)) explicitConstraints.add(match[1]!)
      const migration = await import(new URL(file, migrationsDirectory).href)
      await migration.default.up(db)
    }

    const relations = (await sql<{ name: string; kind: string }>`
      SELECT c.relname AS name, c.relkind AS kind FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'extensions'
    `.execute(db)).rows
    const tables = relations.filter(row => row.kind === 'r').map(row => row.name).sort()
    expect(tables).toHaveLength(11)
    expect(tables.every(table => table.startsWith(`${extension.key.replaceAll('-', '_')}_`))).toBe(true)
    expect(extension.auditOwnership?.map(owner => owner.table).sort())
      .toEqual(tables.map(table => `extensions.${table}`))

    const constraints = (await sql<{ name: string; table: string; type: string; columns: string[] }>`
      SELECT c.conname AS name, t.relname AS table, c.contype AS type,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, position)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.position) AS columns
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'extensions'
    `.execute(db)).rows
    for (const row of [...relations, ...constraints]) expect(Buffer.byteLength(row.name), row.name).toBeLessThanOrEqual(63)
    for (const constraint of constraints) {
      if (explicitConstraints.has(constraint.name)) continue
      const suffix = constraint.type === 'p' ? 'pkey'
        : constraint.type === 'u' ? 'key' : constraint.type === 'f' ? 'fkey' : 'check'
      const columns = constraint.type === 'p' ? [] : constraint.columns
      const untruncated = [constraint.table, ...columns, suffix].join('_')
      expect(Buffer.byteLength(untruncated), untruncated).toBeLessThanOrEqual(63)
      expect(constraint.name).toBe(untruncated)
    }
    expect(constraints.map(row => row.name)).toContain('gcs_ssc_portal_connector_receipt_item_key')
    expect(constraints.map(row => row.name)).toContain('gcs_ssc_portal_connector_publication_source_key')
  } finally {
    try {
      await db.rollback().execute()
    } finally {
      await connection.destroy()
    }
  }
}, 30_000)
