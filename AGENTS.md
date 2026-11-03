# Instructions for agents

Rules for any AI agent (Claude Code, Copilot, etc.) that opens issues or pull requests in this repository. Project conventions live in [docs/](docs/).

## Linking a pull request to its issue

- A pull request based on an issue **must** be linked to it. No exceptions.
- Use a closing keyword (`Closes`, `Fixes` or `Resolves`) **repeated for every issue**, one issue per keyword, each on its own line:

  ```
  Closes #529
  Closes #530
  ```

- **Never** write `Closes #529 and #530`, `Closes #529, #530` or `Closes #529 / #530`. GitHub only honours the keyword for the issue directly after it, so every other issue stays open after the merge. (This already happened.)
- Put the keywords in the **PR description** (not only in a commit message or a comment). The keywords only work when the PR targets the default branch; for any other base, close the issues by hand after merging.
- If the PR only touches part of an issue, use `Refs #N` instead and say what is left; the issue must stay open.
- After opening the PR, check that the issue sidebar of the PR ("Development") lists **every** issue it should close. After merging, check that they are closed; close any that are not, with a comment pointing to the PR.

## The "Open-source development" project board

- Every issue **must** be on the **Open-source development** project board.
- Every pull request that has **no linked issue** must also be on the board. (A PR with a linked issue is tracked through its issue.)
- Every item on the board must have **all of the board's properties filled in** (Status, Priority and every other field the board defines). Do not leave a field empty: set it when you add the item, and keep Status current as the work moves (opened, in review, merged or closed).
- If you cannot reach the board (for example no project permissions, or GraphQL is blocked in your environment), say so explicitly in your final message and in the PR or issue description, so a human can finish it. Never claim the board is up to date when you could not check it.

## Before finishing a task

1. The PR description has one closing keyword per issue, or `Refs` where the issue stays open.
2. The issue(s) or the PR are on the board, with every property filled in.
3. Nothing above was skipped silently: report what you could not do.
