# Contributing

Thanks for taking an interest.

## Copyright assignment is required

This project is dual-licensed: AGPL-3.0-or-later for everyone, and a separate
commercial licence for those who need one. That is only possible while a single
party holds the copyright in the whole work.

**By opening a pull request you assign copyright in your contribution to
Ben Richardson**, and confirm that you have the right to do so — that the work is
yours, and that no employer or client has a claim over it. Contributions that
cannot be assigned cannot be merged, however good they are.

Your contribution is then licensed back to you, and to everyone else, under the
AGPL like the rest of the project.

## Corrections about a named individual

This site reproduces a public register that names real people. If something here
is wrong about you:

- **If the register itself is wrong**, ASIC is the authority — this site cannot
  correct the underlying record, and a change here would only be overwritten at
  the next data refresh.
- **If the register is right and this site has misrepresented it** — a parsing
  fault, a wrong date, a mislabelled ownership chain — that is a bug and it will
  be fixed. Use the Feedback link in the site footer or open an issue.

## Practical notes

- `npm test` must pass. New parsing behaviour needs a test; new gates must be
  proven to **fail** on the exact fault they claim to catch, which is the
  convention the existing gate tests follow.
- Every first-party source file carries an SPDX header.
- Charts are hand-rolled SVG on purpose. Please do not add a charting library.
- Please do not add analytics, trackers, or third-party fonts.
