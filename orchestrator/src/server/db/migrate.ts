/**
 * Database migration script - creates tables if they don't exist.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import DatabaseConstructor from "better-sqlite3";
import { getDataDir } from "../config/dataDir";

// Database path - can be overridden via env for Docker
const DB_PATH = join(getDataDir(), "jobs.db");

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const sqlite = new DatabaseConstructor(DB_PATH);

const migrations = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default-user',
    source TEXT NOT NULL DEFAULT 'gradcracker',
    source_job_id TEXT,
    job_url_direct TEXT,
    date_posted TEXT,
    job_type TEXT,
    salary_source TEXT,
    salary_interval TEXT,
    salary_min_amount REAL,
    salary_max_amount REAL,
    salary_currency TEXT,
    is_remote INTEGER,
    job_level TEXT,
    job_function TEXT,
    listing_type TEXT,
    emails TEXT,
    company_industry TEXT,
    company_logo TEXT,
    company_url_direct TEXT,
    company_addresses TEXT,
    company_num_employees TEXT,
    company_revenue TEXT,
    company_description TEXT,
    skills TEXT,
    experience_range TEXT,
    company_rating REAL,
    company_reviews_count INTEGER,
    vacancy_count INTEGER,
    work_from_home_type TEXT,
    title TEXT NOT NULL,
    employer TEXT NOT NULL,
    employer_url TEXT,
    job_url TEXT NOT NULL UNIQUE,
    application_link TEXT,
    disciplines TEXT,
    deadline TEXT,
    salary TEXT,
    location TEXT,
    degree_required TEXT,
    starting TEXT,
    job_description TEXT,
    status TEXT NOT NULL DEFAULT 'discovered' CHECK(status IN ('discovered', 'processing', 'ready', 'applied', 'in_progress', 'skipped', 'expired')),
    outcome TEXT,
    closed_at INTEGER,
    suitability_score REAL,
    suitability_reason TEXT,
    tailored_summary TEXT,
    tailored_headline TEXT,
    tailored_skills TEXT,
    selected_project_ids TEXT,
    pdf_path TEXT,
    tracer_links_enabled INTEGER NOT NULL DEFAULT 0,
    sponsor_match_score REAL,
    sponsor_match_names TEXT,
    discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    ready_at TEXT,
    applied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default-user',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
    jobs_discovered INTEGER NOT NULL DEFAULT 0,
    jobs_processed INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default-user',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS design_resume_documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default-user',
    title TEXT NOT NULL,
    resume_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    source_resume_id TEXT,
    source_mode TEXT CHECK(source_mode IN ('v4', 'v5')),
    imported_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS design_resume_assets (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'picture' CHECK(kind IN ('picture')),
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES design_resume_documents(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_design_resume_assets_document_id
    ON design_resume_assets(document_id)`,

  `CREATE TABLE IF NOT EXISTS job_chat_threads (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT,
    active_root_message_id TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS job_chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'partial' CHECK(status IN ('complete', 'partial', 'cancelled', 'failed')),
    tokens_in INTEGER,
    tokens_out INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    replaces_message_id TEXT,
    parent_message_id TEXT,
    active_child_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES job_chat_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS job_chat_runs (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'cancelled', 'failed')),
    model TEXT,
    provider TEXT,
    error_code TEXT,
    error_message TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    request_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES job_chat_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS stage_events (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    group_id TEXT,
    from_stage TEXT,
    to_stage TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    metadata TEXT,
    outcome TEXT,
    FOREIGN KEY (application_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    due_date INTEGER,
    is_completed INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (application_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL,
    duration_mins INTEGER,
    type TEXT NOT NULL,
    outcome TEXT,
    FOREIGN KEY (application_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS post_application_integrations (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK(provider IN ('gmail', 'imap')),
    account_key TEXT NOT NULL DEFAULT 'default',
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('disconnected', 'connected', 'error')),
    credentials TEXT,
    last_connected_at INTEGER,
    last_synced_at INTEGER,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(provider, account_key)
  )`,

  `CREATE TABLE IF NOT EXISTS post_application_sync_runs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK(provider IN ('gmail', 'imap')),
    account_key TEXT NOT NULL DEFAULT 'default',
    integration_id TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    messages_discovered INTEGER NOT NULL DEFAULT 0,
    messages_relevant INTEGER NOT NULL DEFAULT 0,
    messages_classified INTEGER NOT NULL DEFAULT 0,
    messages_matched INTEGER NOT NULL DEFAULT 0,
    messages_approved INTEGER NOT NULL DEFAULT 0,
    messages_denied INTEGER NOT NULL DEFAULT 0,
    messages_errored INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (integration_id) REFERENCES post_application_integrations(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS post_application_messages (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK(provider IN ('gmail', 'imap')),
    account_key TEXT NOT NULL DEFAULT 'default',
    integration_id TEXT,
    sync_run_id TEXT,
    external_message_id TEXT NOT NULL,
    external_thread_id TEXT,
    from_address TEXT NOT NULL DEFAULT '',
    from_domain TEXT,
    sender_name TEXT,
    subject TEXT NOT NULL DEFAULT '',
    received_at INTEGER NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    classification_label TEXT,
    classification_confidence REAL,
    classification_payload TEXT,
    relevance_llm_score REAL,
    relevance_decision TEXT NOT NULL DEFAULT 'needs_llm' CHECK(relevance_decision IN ('relevant', 'not_relevant', 'needs_llm')),
    match_confidence INTEGER,
    message_type TEXT NOT NULL DEFAULT 'other' CHECK(message_type IN ('interview', 'rejection', 'offer', 'update', 'other')),
    stage_event_payload TEXT,
    processing_status TEXT NOT NULL DEFAULT 'pending_user' CHECK(processing_status IN ('auto_linked', 'pending_user', 'manual_linked', 'ignored')),
    matched_job_id TEXT,
    decided_at INTEGER,
    decided_by TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (integration_id) REFERENCES post_application_integrations(id) ON DELETE SET NULL,
    FOREIGN KEY (sync_run_id) REFERENCES post_application_sync_runs(id) ON DELETE SET NULL,
    FOREIGN KEY (matched_job_id) REFERENCES jobs(id) ON DELETE SET NULL,
    UNIQUE(provider, account_key, external_message_id)
  )`,

  `CREATE TABLE IF NOT EXISTS tracer_links (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    job_id TEXT NOT NULL,
    source_path TEXT NOT NULL,
    source_label TEXT NOT NULL,
    destination_url TEXT NOT NULL,
    destination_url_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    UNIQUE(job_id, source_path, destination_url_hash)
  )`,

  `CREATE TABLE IF NOT EXISTS tracer_click_events (
    id TEXT PRIMARY KEY,
    tracer_link_id TEXT NOT NULL,
    clicked_at INTEGER NOT NULL,
    request_id TEXT,
    is_likely_bot INTEGER NOT NULL DEFAULT 0,
    device_type TEXT NOT NULL DEFAULT 'unknown',
    ua_family TEXT NOT NULL DEFAULT 'unknown',
    os_family TEXT NOT NULL DEFAULT 'unknown',
    referrer_host TEXT,
    ip_hash TEXT,
    unique_fingerprint_hash TEXT,
    FOREIGN KEY (tracer_link_id) REFERENCES tracer_links(id) ON DELETE CASCADE
  )`,

  // Rename settings key: webhookUrl -> pipelineWebhookUrl (safe to re-run)
  `INSERT OR REPLACE INTO settings(key, value, created_at, updated_at)
   SELECT 'pipelineWebhookUrl', value, created_at, updated_at FROM settings WHERE key = 'webhookUrl'`,
  `DELETE FROM settings WHERE key = 'webhookUrl'`,
  // Drop legacy settings keys that are no longer read by the app.
  `DELETE FROM settings
   WHERE key IN (
     'jobspyHoursOld',
     'jobspySites',
     'jobspyLinkedinFetchDescription',
     'jobspyIsRemote',
     'openrouterApiKey'
   )`,

  // Add source column for existing databases (safe to skip if already present)
  `ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'gradcracker'`,
  `UPDATE jobs SET source = 'gradcracker' WHERE source IS NULL OR source = ''`,

  // Add JobSpy columns for existing databases (safe to skip if already present)
  `ALTER TABLE jobs ADD COLUMN source_job_id TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_url_direct TEXT`,
  `ALTER TABLE jobs ADD COLUMN date_posted TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_type TEXT`,
  `ALTER TABLE jobs ADD COLUMN salary_source TEXT`,
  `ALTER TABLE jobs ADD COLUMN salary_interval TEXT`,
  `ALTER TABLE jobs ADD COLUMN salary_min_amount REAL`,
  `ALTER TABLE jobs ADD COLUMN salary_max_amount REAL`,
  `ALTER TABLE jobs ADD COLUMN salary_currency TEXT`,
  `ALTER TABLE jobs ADD COLUMN is_remote INTEGER`,
  `ALTER TABLE jobs ADD COLUMN job_level TEXT`,
  `ALTER TABLE jobs ADD COLUMN job_function TEXT`,
  `ALTER TABLE jobs ADD COLUMN listing_type TEXT`,
  `ALTER TABLE jobs ADD COLUMN emails TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_industry TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_logo TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_url_direct TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_addresses TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_num_employees TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_revenue TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_description TEXT`,
  `ALTER TABLE jobs ADD COLUMN skills TEXT`,
  `ALTER TABLE jobs ADD COLUMN experience_range TEXT`,
  `ALTER TABLE jobs ADD COLUMN company_rating REAL`,
  `ALTER TABLE jobs ADD COLUMN company_reviews_count INTEGER`,
  `ALTER TABLE jobs ADD COLUMN vacancy_count INTEGER`,
  `ALTER TABLE jobs ADD COLUMN work_from_home_type TEXT`,
  `ALTER TABLE jobs ADD COLUMN selected_project_ids TEXT`,
  `ALTER TABLE jobs ADD COLUMN tailored_headline TEXT`,
  `ALTER TABLE jobs ADD COLUMN tailored_skills TEXT`,
  `ALTER TABLE jobs ADD COLUMN tracer_links_enabled INTEGER NOT NULL DEFAULT 0`,

  // Add user_id columns for existing databases
  `ALTER TABLE jobs ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default-user'`,
  `ALTER TABLE pipeline_runs ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default-user'`,
  `ALTER TABLE settings ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default-user'`,
  `ALTER TABLE design_resume_documents ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default-user'`,

  // Add application tracking columns
  `ALTER TABLE jobs ADD COLUMN outcome TEXT`,
  `ALTER TABLE jobs ADD COLUMN closed_at INTEGER`,
  `ALTER TABLE jobs ADD COLUMN ready_at TEXT`,
  `ALTER TABLE stage_events ADD COLUMN outcome TEXT`,
  `ALTER TABLE stage_events ADD COLUMN title TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE stage_events ADD COLUMN group_id TEXT`,
  `UPDATE jobs
   SET ready_at = COALESCE(ready_at, updated_at)
   WHERE status = 'ready' AND ready_at IS NULL`,

  // Smart-router columns for existing databases.
  `ALTER TABLE post_application_messages ADD COLUMN match_confidence INTEGER`,
  `ALTER TABLE post_application_messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'other' CHECK(message_type IN ('interview', 'rejection', 'offer', 'update', 'other'))`,
  `ALTER TABLE post_application_messages ADD COLUMN stage_event_payload TEXT`,
  `ALTER TABLE post_application_messages ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'pending_user' CHECK(processing_status IN ('auto_linked', 'pending_user', 'manual_linked', 'ignored'))`,
  `UPDATE post_application_messages
   SET match_confidence = CAST(round(COALESCE(relevance_llm_score, 0)) AS INTEGER)
   WHERE match_confidence IS NULL`,
  `UPDATE post_application_messages
   SET message_type = CASE
      WHEN lower(COALESCE(classification_label, '')) LIKE '%interview%' THEN 'interview'
      WHEN lower(COALESCE(classification_label, '')) LIKE '%offer%' THEN 'offer'
      WHEN lower(COALESCE(classification_label, '')) LIKE '%reject%' THEN 'rejection'
      WHEN lower(COALESCE(classification_label, '')) IN ('false positive', 'did not apply - inbound request') THEN 'other'
      ELSE 'update'
   END`,
  `UPDATE post_application_messages
   SET processing_status = CASE
      WHEN review_status = 'approved' THEN 'manual_linked'
      WHEN review_status IN ('pending_review', 'no_reliable_match') THEN 'pending_user'
      ELSE 'ignored'
   END`,
  `DROP TABLE IF EXISTS post_application_message_candidates`,
  `DROP TABLE IF EXISTS post_application_message_links`,

  // Protect child tables (stage_events/tasks/interviews) during parent table rebuilds.
  // Without this, dropping/replacing `jobs` can cascade-delete historical stage data.
  `PRAGMA foreign_keys = OFF`,

  // Ensure pipeline_runs status supports "cancelled" for existing databases.
  `CREATE TABLE IF NOT EXISTS pipeline_runs_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default-user',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
    jobs_discovered INTEGER NOT NULL DEFAULT 0,
    jobs_processed INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  )`,
  `INSERT OR REPLACE INTO pipeline_runs_new (id, user_id, started_at, completed_at, status, jobs_discovered, jobs_processed, error_message)
   SELECT id, COALESCE(user_id, 'default-user'), started_at, completed_at, status, jobs_discovered, jobs_processed, error_message
   FROM pipeline_runs`,
  `DROP TABLE IF EXISTS pipeline_runs`,
  `ALTER TABLE pipeline_runs_new RENAME TO pipeline_runs`,

  // Ensure jobs status supports "in_progress" for existing databases.
  `CREATE TABLE IF NOT EXISTS jobs_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default-user',
    source TEXT NOT NULL DEFAULT 'gradcracker',
    source_job_id TEXT,
    job_url_direct TEXT,
    date_posted TEXT,
    job_type TEXT,
    salary_source TEXT,
    salary_interval TEXT,
    salary_min_amount REAL,
    salary_max_amount REAL,
    salary_currency TEXT,
    is_remote INTEGER,
    job_level TEXT,
    job_function TEXT,
    listing_type TEXT,
    emails TEXT,
    company_industry TEXT,
    company_logo TEXT,
    company_url_direct TEXT,
    company_addresses TEXT,
    company_num_employees TEXT,
    company_revenue TEXT,
    company_description TEXT,
    skills TEXT,
    experience_range TEXT,
    company_rating REAL,
    company_reviews_count INTEGER,
    vacancy_count INTEGER,
    work_from_home_type TEXT,
    title TEXT NOT NULL,
    employer TEXT NOT NULL,
    employer_url TEXT,
    job_url TEXT NOT NULL UNIQUE,
    application_link TEXT,
    disciplines TEXT,
    deadline TEXT,
    salary TEXT,
    location TEXT,
    degree_required TEXT,
    starting TEXT,
    job_description TEXT,
    status TEXT NOT NULL DEFAULT 'discovered' CHECK(status IN ('discovered', 'processing', 'ready', 'applied', 'in_progress', 'skipped', 'expired')),
    outcome TEXT,
    closed_at INTEGER,
    suitability_score REAL,
    suitability_reason TEXT,
    tailored_summary TEXT,
    tailored_headline TEXT,
    tailored_skills TEXT,
    selected_project_ids TEXT,
    pdf_path TEXT,
    tracer_links_enabled INTEGER NOT NULL DEFAULT 0,
    sponsor_match_score REAL,
    sponsor_match_names TEXT,
    discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    ready_at TEXT,
    applied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `INSERT OR REPLACE INTO jobs_new (
    id, user_id, source, source_job_id, job_url_direct, date_posted, job_type, salary_source, salary_interval,
    salary_min_amount, salary_max_amount, salary_currency, is_remote, job_level, job_function, listing_type,
    emails, company_industry, company_logo, company_url_direct, company_addresses, company_num_employees,
    company_revenue, company_description, skills, experience_range, company_rating, company_reviews_count,
    vacancy_count, work_from_home_type, title, employer, employer_url, job_url, application_link, disciplines,
    deadline, salary, location, degree_required, starting, job_description, status, outcome, closed_at,
    suitability_score, suitability_reason, tailored_summary, tailored_headline, tailored_skills,
    selected_project_ids, pdf_path, tracer_links_enabled, sponsor_match_score, sponsor_match_names, discovered_at, processed_at,
    ready_at,
    applied_at, created_at, updated_at
  )
  SELECT
    id, COALESCE(user_id, 'default-user'), source, source_job_id, job_url_direct, date_posted, job_type, salary_source, salary_interval,
    salary_min_amount, salary_max_amount, salary_currency, is_remote, job_level, job_function, listing_type,
    emails, company_industry, company_logo, company_url_direct, company_addresses, company_num_employees,
    company_revenue, company_description, skills, experience_range, company_rating, company_reviews_count,
    vacancy_count, work_from_home_type, title, employer, employer_url, job_url, application_link, disciplines,
    deadline, salary, location, degree_required, starting, job_description, status, outcome, closed_at,
    suitability_score, suitability_reason, tailored_summary, tailored_headline, tailored_skills,
    selected_project_ids, pdf_path, tracer_links_enabled, sponsor_match_score, sponsor_match_names, discovered_at, processed_at,
    ready_at,
    applied_at, created_at, updated_at
  FROM jobs`,
  `DROP TABLE IF EXISTS jobs`,
  `ALTER TABLE jobs_new RENAME TO jobs`,
  `PRAGMA foreign_keys = ON`,

  `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_discovered_at ON jobs(discovered_at)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status_discovered_at ON jobs(status, discovered_at)`,
  `CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at ON pipeline_runs(started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_stage_events_application_id ON stage_events(application_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stage_events_occurred_at ON stage_events(occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_application_id ON tasks(application_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date)`,
  `CREATE INDEX IF NOT EXISTS idx_interviews_application_id ON interviews(application_id)`,
  `CREATE INDEX IF NOT EXISTS idx_post_app_sync_runs_provider_account_started_at ON post_application_sync_runs(provider, account_key, started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_post_app_messages_provider_account_processing_status ON post_application_messages(provider, account_key, processing_status)`,
  `CREATE INDEX IF NOT EXISTS idx_job_chat_threads_job_updated ON job_chat_threads(job_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_chat_messages_thread_created ON job_chat_messages(thread_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_chat_runs_thread_status ON job_chat_runs(thread_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_tracer_links_token ON tracer_links(token)`,
  `CREATE INDEX IF NOT EXISTS idx_tracer_links_job_id ON tracer_links(job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tracer_click_events_tracer_link_id ON tracer_click_events(tracer_link_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tracer_click_events_clicked_at ON tracer_click_events(clicked_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tracer_click_events_is_likely_bot ON tracer_click_events(is_likely_bot)`,
  `CREATE INDEX IF NOT EXISTS idx_tracer_click_events_unique_fingerprint_hash ON tracer_click_events(unique_fingerprint_hash)`,
  // Ensure only one running run per thread; backfill any duplicates first.
  `WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY started_at DESC, id DESC) AS rank_in_thread
      FROM job_chat_runs
      WHERE status = 'running'
    )
    UPDATE job_chat_runs
    SET
      status = 'failed',
      error_code = COALESCE(error_code, 'CONFLICT'),
      error_message = COALESCE(error_message, 'Recovered duplicate running run during migration'),
      completed_at = COALESCE(completed_at, CAST(strftime('%s', 'now') AS INTEGER)),
      updated_at = datetime('now')
    WHERE id IN (SELECT id FROM ranked WHERE rank_in_thread > 1)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_job_chat_runs_thread_running_unique
   ON job_chat_runs(thread_id)
   WHERE status = 'running'`,

  // Backfill: Create "Applied" events for legacy jobs that have applied_at set but no event entry
  `INSERT INTO stage_events (id, application_id, title, from_stage, to_stage, occurred_at, metadata)
   SELECT
     'backfill-applied-' || id,
     id,
     'Applied',
     NULL,
     'applied',
     CAST(strftime('%s', applied_at) AS INTEGER),
     '{"eventLabel":"Applied","actor":"system"}'
   FROM jobs
   WHERE applied_at IS NOT NULL
     AND id NOT IN (SELECT application_id FROM stage_events WHERE to_stage = 'applied')`,

  // Backfill: Create "Closed" events for legacy jobs already closed via outcome.
  `INSERT INTO stage_events (id, application_id, title, from_stage, to_stage, occurred_at, metadata, outcome)
   SELECT
     'backfill-closed-' || jobs.id,
     jobs.id,
     'Closed',
     (
       SELECT se.to_stage
       FROM stage_events se
       WHERE se.application_id = jobs.id
       ORDER BY se.occurred_at DESC, se.id DESC
       LIMIT 1
     ),
     'closed',
     COALESCE(
       jobs.closed_at,
       CAST(strftime('%s', jobs.applied_at) AS INTEGER),
       CAST(strftime('%s', jobs.updated_at) AS INTEGER),
       CAST(strftime('%s', jobs.discovered_at) AS INTEGER),
       CAST(strftime('%s', 'now') AS INTEGER)
     ),
     '{"eventLabel":"Closed","actor":"system"}',
     jobs.outcome
   FROM jobs
   WHERE jobs.outcome IS NOT NULL
     AND jobs.id NOT IN (SELECT application_id FROM stage_events WHERE to_stage = 'closed')`,

  // Backfill: Sync legacy workflow status from latest stage event.
  `UPDATE jobs
   SET
     status = 'in_progress',
     updated_at = datetime('now')
   WHERE status = 'applied'
     AND COALESCE((
       SELECT se.to_stage
       FROM stage_events se
       WHERE se.application_id = jobs.id
       ORDER BY se.occurred_at DESC, se.id DESC
       LIMIT 1
     ), 'applied') IN (
       'recruiter_screen',
       'assessment',
       'hiring_manager_screen',
       'technical_interview',
       'onsite',
       'offer',
       'closed'
     )`,

  // Branching conversations: add parent_message_id and active_child_id to job_chat_messages
  `ALTER TABLE job_chat_messages ADD COLUMN parent_message_id TEXT`,
  `ALTER TABLE job_chat_messages ADD COLUMN active_child_id TEXT`,
  `ALTER TABLE job_chat_threads ADD COLUMN active_root_message_id TEXT`,

  // Backfill: link existing messages into a linear chain (each message's parent = its predecessor)
  `UPDATE job_chat_messages
   SET parent_message_id = (
     SELECT prev.id
     FROM job_chat_messages prev
     WHERE prev.thread_id = job_chat_messages.thread_id
       AND prev.created_at < job_chat_messages.created_at
     ORDER BY prev.created_at DESC
     LIMIT 1
   )
   WHERE parent_message_id IS NULL`,

  // Backfill: for regenerated messages, re-link as siblings (same parent as the message they replaced)
  `UPDATE job_chat_messages
   SET parent_message_id = (
     SELECT orig.parent_message_id
     FROM job_chat_messages orig
     WHERE orig.id = job_chat_messages.replaces_message_id
   )
   WHERE replaces_message_id IS NOT NULL`,

  // Backfill: set active_child_id on every parent to its newest child
  `UPDATE job_chat_messages
   SET active_child_id = (
     SELECT child.id
     FROM job_chat_messages child
     WHERE child.parent_message_id = job_chat_messages.id
     ORDER BY child.created_at DESC
     LIMIT 1
   )
   WHERE id IN (SELECT DISTINCT parent_message_id FROM job_chat_messages WHERE parent_message_id IS NOT NULL)`,

  `CREATE INDEX IF NOT EXISTS idx_job_chat_messages_parent ON job_chat_messages(parent_message_id)`,

  // Backfill: Mark closed applications from latest stage event.
  `UPDATE jobs
   SET
     status = 'in_progress',
     closed_at = (
       SELECT se.occurred_at
       FROM stage_events se
       WHERE se.application_id = jobs.id
       ORDER BY se.occurred_at DESC, se.id DESC
       LIMIT 1
     ),
     outcome = COALESCE((
       SELECT se.outcome
       FROM stage_events se
       WHERE se.application_id = jobs.id
       ORDER BY se.occurred_at DESC, se.id DESC
       LIMIT 1
     ), outcome),
     updated_at = datetime('now')
   WHERE status IN ('applied', 'in_progress')
     AND COALESCE((
       SELECT se.to_stage
       FROM stage_events se
       WHERE se.application_id = jobs.id
       ORDER BY se.occurred_at DESC, se.id DESC
       LIMIT 1
     ), 'applied') = 'closed'`,

  // Pipeline run organization: stamp jobs with the run that discovered them
  // and persist a config snapshot per run. Placed after the table rebuilds so
  // the columns survive on both fresh and upgraded databases.
  `ALTER TABLE jobs ADD COLUMN discovered_by_run_id TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_discovered_by_run ON jobs (discovered_by_run_id)`,
  `ALTER TABLE pipeline_runs ADD COLUMN config TEXT`,

  `CREATE TABLE IF NOT EXISTS job_searches (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default-user',
    admission_hash TEXT NOT NULL DEFAULT '',
    spec_hash TEXT,
    parser_version TEXT,
    source_plan_version TEXT,
    original_query TEXT NOT NULL,
    parsed_spec TEXT,
    phase TEXT NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued', 'parsing', 'planning', 'aggregating', 'filtering', 'provisional_results', 'ranking', 'reporting', 'emailing', 'completed', 'failed')),
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
    sources_searched TEXT,
    sources_succeeded TEXT,
    sources_failed TEXT,
    results TEXT,
    result_version INTEGER NOT NULL DEFAULT 0,
    source_plan TEXT,
    evaluation_time TEXT,
    search_started_at TEXT,
    search_completed_at TEXT,
    email_status TEXT NOT NULL DEFAULT 'pending' CHECK(email_status IN ('pending', 'sent', 'failed', 'skipped')),
    email_sent_at TEXT,
    email_error TEXT,
    error_message TEXT,
    last_progress_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_job_searches_user_created ON job_searches(user_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS agentic_searches (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default-user',
    original_query TEXT NOT NULL,
    query_hash TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created', 'planning', 'searching', 'normalizing', 'deduplicating', 'filtering', 'evaluating', 'verifying', 'refining', 'ranking', 'reporting', 'completed', 'failed', 'partial', 'cancelled', 'timed_out')),
    goal TEXT,
    hard_constraints TEXT,
    soft_preferences TEXT,
    search_plan TEXT,
    current_step TEXT,
    iteration_count INTEGER NOT NULL DEFAULT 0,
    max_iterations INTEGER NOT NULL DEFAULT 8,
    results TEXT,
    budget_used TEXT,
    search_expansions TEXT,
    started_at TEXT,
    completed_at TEXT,
    failure_reason TEXT,
    fallback_search_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agentic_searches_user_created ON agentic_searches(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agentic_searches_status ON agentic_searches(status)`,

  `CREATE TABLE IF NOT EXISTS agentic_tool_calls (
    id TEXT PRIMARY KEY,
    search_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    arguments_summary TEXT,
    result_summary TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
    latency_ms INTEGER,
    iteration INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (search_id) REFERENCES agentic_searches(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agentic_tool_calls_search_id ON agentic_tool_calls(search_id)`,

  `CREATE TABLE IF NOT EXISTS job_verifications (
    id TEXT PRIMARY KEY,
    search_id TEXT,
    job_url TEXT NOT NULL,
    constraint_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('verified', 'not_verified', 'contradicted', 'unknown')),
    confidence REAL,
    evidence TEXT,
    verified_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (search_id) REFERENCES agentic_searches(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_job_verifications_search_id ON job_verifications(search_id)`,
  `CREATE INDEX IF NOT EXISTS idx_job_verifications_job_url ON job_verifications(job_url)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_job_verifications_job_constraint ON job_verifications(job_url, constraint_key)`,
  `CREATE TABLE IF NOT EXISTS user_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default-user',
    source TEXT NOT NULL DEFAULT 'pdf_upload',
    full_name TEXT,
    email TEXT,
    phone TEXT,
    location TEXT,
    headline TEXT,
    summary TEXT,
    skills TEXT,
    experience TEXT,
    education TEXT,
    certifications TEXT,
    languages TEXT,
    links TEXT,
    file_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id)`,

  // Multi-schedule pipeline: create the pipeline_schedules table.
  `CREATE TABLE IF NOT EXISTS pipeline_schedules (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    hour INTEGER NOT NULL DEFAULT 2,
    sources TEXT NOT NULL DEFAULT '[]',
    search_terms TEXT,
    country TEXT,
    city_locations TEXT,
    workplace_types TEXT,
    top_n INTEGER,
    min_suitability_score INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pipeline_schedules_enabled ON pipeline_schedules(enabled)`,
  // Backward-compat seeding: if old single-schedule settings exist and the new
  // table is empty, seed one row from the old settings so existing users don't
  // lose their schedule. Runs once; the IF NOT EXISTS guard makes it safe to
  // re-run.
  `INSERT INTO pipeline_schedules (id, label, enabled, hour, sources, created_at, updated_at)
   SELECT
     'migrated-schedule',
     'Migrated schedule',
     CASE WHEN EXISTS (SELECT 1 FROM settings WHERE key = 'pipelineScheduleEnabled' AND value IN ('1', 'true')) THEN 1 ELSE 0 END,
     COALESCE(CAST((SELECT value FROM settings WHERE key = 'pipelineScheduleHour') AS INTEGER), 2),
     COALESCE((SELECT value FROM settings WHERE key = 'pipelineScheduleSources'), '[]'),
     datetime('now'),
     datetime('now')
   WHERE NOT EXISTS (SELECT 1 FROM pipeline_schedules)
     AND EXISTS (SELECT 1 FROM settings WHERE key IN ('pipelineScheduleEnabled', 'pipelineScheduleHour', 'pipelineScheduleSources'))`,

  // Periodic search scanning: create the search_schedules table.
  `CREATE TABLE IF NOT EXISTS search_schedules (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    frequency TEXT NOT NULL DEFAULT 'daily' CHECK(frequency IN ('hourly', 'daily')),
    hour INTEGER,
    minute INTEGER NOT NULL DEFAULT 0,
    query TEXT NOT NULL,
    notify_email INTEGER NOT NULL DEFAULT 1,
    notify_webhook INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    last_search_id TEXT,
    last_results_count INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_search_schedules_enabled ON search_schedules(enabled)`,
];

export function runMigrations(db: Database.Database): void {
  console.log("🔧 Running database migrations...");

  for (const migration of migrations) {
    try {
      db.exec(migration);
      console.log("✅ Migration applied");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isDuplicateColumn =
        migration.toLowerCase().includes("add column") &&
        message.toLowerCase().includes("duplicate column name");

      if (isDuplicateColumn) {
        console.log("↩️ Migration skipped (column already exists)");
        continue;
      }

      const isLegacyBackfillOnFreshSchema =
        migration.toLowerCase().includes("update post_application_messages") &&
        message.toLowerCase().includes("no such column");
      if (isLegacyBackfillOnFreshSchema) {
        console.log("↩️ Migration skipped (legacy backfill not applicable)");
        continue;
      }

      // Optional performance-only migration: if this fails we should still boot
      // existing databases and continue without the index.
      const isOptionalOptimizationMigration = migration.includes(
        "idx_jobs_status_discovered_at",
      );
      if (isOptionalOptimizationMigration) {
        console.warn("⚠️ Optional migration skipped:", message);
        continue;
      }

      console.error("❌ Migration failed:", error);
      throw error;
    }
  }

  // Rebuild legacy settings table (key as PK, no id column) to match the
  // current schema. CREATE TABLE IF NOT EXISTS skips legacy tables, so the
  // column-presence check below is the only way to upgrade them.
  const settingsHasId = db
    .prepare(
      "SELECT count(*) AS n FROM pragma_table_info('settings') WHERE name = 'id'",
    )
    .get() as { n: number };
  if (settingsHasId.n === 0) {
    db.exec(`
      CREATE TABLE settings_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default-user',
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO settings_new (id, user_id, key, value, created_at, updated_at)
        SELECT 'legacy-' || key, COALESCE(user_id, 'default-user'), key, value,
               COALESCE(created_at, datetime('now')), COALESCE(updated_at, datetime('now'))
        FROM settings;
      DROP TABLE settings;
      ALTER TABLE settings_new RENAME TO settings;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_user_key_unique ON settings(user_id, key);
    `);
    console.log("✅ Rebuilt legacy settings table (added id primary key)");
  }

  // Add scoring enrichment columns (matchGrade, topProject, matchVerdict) if
  // they don't exist. These are added via ALTER TABLE ADD COLUMN which is
  // safe and idempotent (column already exists = skip via pragma check).
  const scoringColumns = [
    {
      name: "match_grade",
      ddl: "ALTER TABLE jobs ADD COLUMN match_grade TEXT",
    },
    {
      name: "top_project",
      ddl: "ALTER TABLE jobs ADD COLUMN top_project TEXT",
    },
    {
      name: "match_verdict",
      ddl: "ALTER TABLE jobs ADD COLUMN match_verdict TEXT",
    },
  ];
  for (const col of scoringColumns) {
    const exists = db
      .prepare(
        `SELECT count(*) AS n FROM pragma_table_info('jobs') WHERE name = ?`,
      )
      .get(col.name) as { n: number };
    if (exists.n === 0) {
      db.exec(col.ddl);
      console.log(`✅ Added column jobs.${col.name}`);
    }
  }

  // Job search v2 (ADR-002): parallel execution columns.
  // All steps are idempotent via pragma checks so the upgrade can be re-run.
  const jobSearchColumns = [
    {
      name: "admission_hash",
      ddl: "ALTER TABLE job_searches ADD COLUMN admission_hash TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "parser_version",
      ddl: "ALTER TABLE job_searches ADD COLUMN parser_version TEXT",
    },
    {
      name: "source_plan_version",
      ddl: "ALTER TABLE job_searches ADD COLUMN source_plan_version TEXT",
    },
    {
      name: "phase",
      ddl: "ALTER TABLE job_searches ADD COLUMN phase TEXT NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued', 'parsing', 'planning', 'aggregating', 'filtering', 'provisional_results', 'ranking', 'reporting', 'emailing', 'completed', 'failed'))",
    },
    {
      name: "result_version",
      ddl: "ALTER TABLE job_searches ADD COLUMN result_version INTEGER NOT NULL DEFAULT 0",
    },
    {
      name: "source_plan",
      ddl: "ALTER TABLE job_searches ADD COLUMN source_plan TEXT",
    },
    {
      name: "evaluation_time",
      ddl: "ALTER TABLE job_searches ADD COLUMN evaluation_time TEXT",
    },
    {
      name: "last_progress_at",
      ddl: "ALTER TABLE job_searches ADD COLUMN last_progress_at TEXT",
    },
  ];
  for (const col of jobSearchColumns) {
    const exists = db
      .prepare(
        `SELECT count(*) AS n FROM pragma_table_info('job_searches') WHERE name = ?`,
      )
      .get(col.name) as { n: number };
    if (exists.n === 0) {
      db.exec(col.ddl);
      console.log(`✅ Added column job_searches.${col.name}`);
    }
  }

  // Rename query_hash -> spec_hash (semantic hash of the parsed spec).
  const specHashExists = db
    .prepare(
      `SELECT count(*) AS n FROM pragma_table_info('job_searches') WHERE name = 'spec_hash'`,
    )
    .get() as { n: number };
  if (specHashExists.n === 0) {
    const queryHashExists = db
      .prepare(
        `SELECT count(*) AS n FROM pragma_table_info('job_searches') WHERE name = 'query_hash'`,
      )
      .get() as { n: number };
    if (queryHashExists.n > 0) {
      db.exec("ALTER TABLE job_searches RENAME COLUMN query_hash TO spec_hash");
      console.log("✅ Renamed job_searches.query_hash -> spec_hash");
      // RENAME COLUMN preserves NOT NULL; schema.ts declares spec_hash nullable.
      try {
        db.exec(
          "ALTER TABLE job_searches ALTER COLUMN spec_hash DROP NOT NULL",
        );
      } catch {
        // Already nullable or unsupported on this SQLite build; harmless.
      }
    } else {
      db.exec("ALTER TABLE job_searches ADD COLUMN spec_hash TEXT");
      console.log("✅ Added column job_searches.spec_hash");
    }
  }

  // Backfill admission_hash from spec_hash for rows created before the upgrade.
  const admissionBackfill = db
    .prepare(
      `SELECT count(*) AS n FROM job_searches WHERE admission_hash = '' AND spec_hash IS NOT NULL`,
    )
    .get() as { n: number };
  if (admissionBackfill.n > 0) {
    db.exec(
      `UPDATE job_searches SET admission_hash = spec_hash WHERE admission_hash = '' AND spec_hash IS NOT NULL`,
    );
    console.log(
      `✅ Backfilled job_searches.admission_hash (${admissionBackfill.n} rows)`,
    );
  }

  // Backfill phase for legacy rows whose status is already terminal.
  db.exec(
    `UPDATE job_searches SET phase = 'completed' WHERE status = 'completed' AND phase = 'queued'`,
  );
  db.exec(
    `UPDATE job_searches SET phase = 'failed' WHERE status = 'failed' AND phase = 'queued'`,
  );

  // Replace the permanent unique hash index with a partial unique index that
  // only covers active (running) searches. Completed searches can be replaced
  // after cache TTL expiry without deleting history.
  const runningIndexExists = db
    .prepare(
      `SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_job_searches_user_admission_running_unique'`,
    )
    .get() as { n: number };
  if (runningIndexExists.n === 0) {
    db.exec("DROP INDEX IF EXISTS idx_job_searches_user_hash_unique");
    db.exec(
      `CREATE UNIQUE INDEX idx_job_searches_user_admission_running_unique
       ON job_searches(user_id, admission_hash)
       WHERE status = 'running'`,
    );
    console.log(
      "✅ Replaced job_searches unique index with partial running index",
    );
  }

  console.log("🎉 Database migrations complete!");
}

// When run directly as a script (not imported), execute migrations and close.
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations(sqlite);
  sqlite.close();
}
