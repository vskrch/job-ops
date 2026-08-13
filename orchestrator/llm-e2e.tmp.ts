import { parseResumeProfile } from "./src/server/services/resume-parser";

const sampleText = `
Jane Doe
jane.doe@example.com | +1 555 010 1234 | San Francisco, CA
Senior Data Engineer
Summary: 8 years building data pipelines and ML infrastructure.
Skills: Python, SQL, AWS, Airflow, dbt, Spark
Experience:
Acme Corp - Senior Data Engineer (2020-01 to 2023-06)
Built real-time ingestion pipelines on AWS.
Globex - Data Engineer (2017-03 to 2019-12)
Owned the data warehouse and BI layer.
Education:
UC Berkeley - B.S. Computer Science (2012-2016)
`;

const started = Date.now();
parseResumeProfile(sampleText)
  .then((profile) => {
    console.log(
      JSON.stringify({
        ok: true,
        durationMs: Date.now() - started,
        name: profile.fullName,
        email: profile.email,
        skills: profile.skills.length,
        experience: profile.experience.length,
      }),
    );
  })
  .catch((error) => {
    console.log(
      JSON.stringify({
        ok: false,
        durationMs: Date.now() - started,
        error: String(error.message ?? error).slice(0, 200),
      }),
    );
    process.exit(1);
  });
