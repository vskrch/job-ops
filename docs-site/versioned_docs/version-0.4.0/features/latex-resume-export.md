---
id: latex-resume-export
title: Built-in LaTeX Resume Export
description: Generate tailored resume PDFs on the fly with the built-in LaTeX exporter — no third-party resume service required.
sidebar_position: 9
---

## What it is

JobOps ships a built-in LaTeX resume formatter and PDF exporter. It compiles tailored resume content into a PDF on the fly using the **Tectonic** LaTeX engine, with no dependency on external resume services.

The pipeline is:

1. **Profile** — your resume data comes from the local Design Resume.
2. **Tailoring (LLM)** — the LLM tailors your summary, headline, and skills against the job description, and selects the most relevant projects.
3. **Template** — your content is injected into a LaTeX template: a preset (`jake` or `modern`) or your own custom `.tex`.
4. **Compile** — Tectonic renders the PDF locally; it is served from `/pdfs/resume_<jobId>.pdf`.

## Why it exists

External resume renderers add a login, an upload, a wait, and a third-party dependency for every PDF. The built-in exporter keeps PDF generation local, offline-capable, fast, and fully in your control.

## How to use it

1. Open **Settings → Reactive Resume → PDF renderer** and choose **LaTeX (built-in)** — this is the default.
2. Choose a template under **LaTeX template**:
   - `jake` — classic single-column, ATS-friendly.
   - `modern` — two-column sans-serif.
   - `custom` — your own `.tex`, pasted into **Custom TeX Code**.
3. (Optional) Enable LLM tailoring as usual; the tailored summary/headline/skills and project selection feed the template automatically.
4. Generate a PDF from **Job Details** or the **Tailoring workspace** as normal.

### Custom template placeholder contract

Custom templates must contain these placeholders (in the preamble/body as needed):

| Placeholder | Content |
| --- | --- |
| `__NAME__` | Your full name |
| `__HEADLINE_BLOCK__` | Tailored headline/label |
| `__CONTACT_BLOCK__` | Email, phone, location, links |
| `__BODY__` | Generated resume sections (summary, experience, education, projects, skills) |

Example minimal template:

```tex
\documentclass[letterpaper,11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[margin=0.75in]{geometry}
\begin{document}
{\huge \textbf{__NAME__}} \hfill \small __CONTACT_BLOCK__

\vspace{0.3em}
\textit{__HEADLINE_BLOCK__}

\vspace{0.5em}
__BODY__
\end{document}
```

Your content is LaTeX-escaped before substitution; text like `&`, `%`, and `_` in resume data is safe to include.

### Engine requirements

- **Docker deployments**: Tectonic is bundled in the image — nothing to install.
- **Bare-metal/local**: install Tectonic (`brew install tectonic`, or `apt install tectonic` on Debian) or point `TECTONIC_BIN` at the binary. The renderer reports a clear error if the binary is missing.
- The first compile downloads needed packages from the Tectonic bundle, so the very first PDF may take a few seconds.

## Common problems

### "Tectonic binary not found"

- Install Tectonic, or set `TECTONIC_BIN=/path/to/tectonic` and retry.

### PDF fails to compile

- Check the server logs — errors are truncated and sanitized for readability.
- Custom templates must be valid LaTeX and contain `__BODY__`. Start from a preset template and modify it.

### "No Design Resume found"

- The built-in exporter builds from your local Design Resume. Import one in **Settings → Reactive Resume** (or Design Resume editor) first. Reactive Resume base resumes are no longer required.

## Related pages

- [Reactive Resume](/docs/next/features/reactive-resume)
- [Settings](/docs/next/features/settings)
- [Post-Application Tracking](/docs/next/features/post-application-tracking)
