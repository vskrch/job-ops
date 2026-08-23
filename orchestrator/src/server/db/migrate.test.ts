import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { runMigrations } from "./migrate";

describe("runMigrations", () => {
  it("preserves current-schema data when migrations run again", () => {
    const db = new Database(":memory:");

    try {
      runMigrations(db);
      db.prepare(
        `INSERT INTO jobs (
          id, title, employer, job_url, match_grade, top_project,
          match_verdict, discovered_by_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "job-1",
        "Engineer",
        "Example",
        "https://example.test/job",
        "A",
        "Project",
        "Strong",
        "run-1",
      );
      db.prepare("INSERT INTO pipeline_runs (id, config) VALUES (?, ?)").run(
        "run-1",
        JSON.stringify({ topN: 5 }),
      );

      runMigrations(db);

      expect(
        db
          .prepare(
            `SELECT match_grade, top_project, match_verdict, discovered_by_run_id
             FROM jobs WHERE id = ?`,
          )
          .get("job-1"),
      ).toEqual({
        match_grade: "A",
        top_project: "Project",
        match_verdict: "Strong",
        discovered_by_run_id: "run-1",
      });
      expect(
        db
          .prepare("SELECT config FROM pipeline_runs WHERE id = ?")
          .get("run-1"),
      ).toEqual({ config: JSON.stringify({ topN: 5 }) });
    } finally {
      db.close();
    }
  });

  it("recovers populated rebuild tables after an interrupted migration", () => {
    const db = new Database(":memory:");

    try {
      runMigrations(db);
      db.prepare(
        "INSERT INTO jobs (id, title, employer, job_url) VALUES (?, ?, ?, ?)",
      ).run("job-1", "Engineer", "Example", "https://example.test/job");
      db.prepare("INSERT INTO pipeline_runs (id) VALUES (?)").run("run-1");

      db.exec("ALTER TABLE jobs RENAME TO jobs_new");
      db.exec("ALTER TABLE pipeline_runs RENAME TO pipeline_runs_new");

      runMigrations(db);

      expect(db.prepare("SELECT id FROM jobs").all()).toEqual([
        { id: "job-1" },
      ]);
      expect(db.prepare("SELECT id FROM pipeline_runs").all()).toEqual([
        { id: "run-1" },
      ]);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('jobs_new', 'pipeline_runs_new')",
          )
          .all(),
      ).toEqual([]);
    } finally {
      db.close();
    }
  });
});
