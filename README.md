# Shortlistr

Turn job boards into a shortlist.

**Shortlistr** is an AI-powered Chrome extension for applicants that adds a **Shortlistr Score (0–100)** directly on job postings—so you can decide fast, save the best roles, and skip the rest.

## What Shortlistr does

- **AI-powered fit scoring on the posting:** Matches the job’s description + requirements against what *you* want, what *you* do well, and your resume (optional)—not just a keyword match.
- **Explains the “why”:** Highlights the signals that make a role a great fit, plus the gaps or red flags that would make it a time sink.
- **Handles fuzzy roles:** Interprets messy titles and vague requirements (e.g., “forward deployed,” “AI-coded,” “applied ML,” “solutions engineer”) so you don’t have to decode every post.
- **Saves automatically when it’s worth your time:** By default, it auto-saves strong targets and prompts you on “modest odds” roles.

## How it works (user flow)

1. **Set your target**: Tell Shortlistr what you’re looking for, the strengths you want to lead with, and (optionally) add your resume.
2. **Open a job post**: On supported sites, Shortlistr analyzes the posting in-place.
3. **Get a Shortlistr Score**:
   - **95–100:** Exceptional / bullseye
   - **87–94:** Very strong fit
   - **79–86:** Good shot (auto-saves by default)
   - **70–78:** Apply, but odds are modest (prompts to save by default)
   - **65–69:** Edge-case / long-shot (manual save by default)
   - **0–64:** Probably no (manual save by default)
4. **Review in Shortlist Inbox**: Your saved roles, with score + rationale and your notes.

## Naming (in-product)

- **Shortlistr Score** (0–100)
- **Shortlist** button (save)
- **Shortlist Inbox** (saved roles view)

## Supported sites (initial)

- LinkedIn
- X
- Wellfound
- Otta

## Status

Shortlistr is under active development. This README is product-first; implementation details (permissions, data handling, and build steps) will be added as features land.

## Development

See `DEVELOPMENT.md`.
