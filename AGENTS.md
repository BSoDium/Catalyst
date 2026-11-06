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
- After opening the PR, check that its "Development" sidebar (or `gh pr view <n> --json closingIssuesReferences`) lists **every** issue it should close. After merging, check that they are closed; close any that are not, with a comment pointing to the PR.

## The "Open-source development" project board

The board is the user project <https://github.com/users/BSoDium/projects/5> (`gh ... --owner BSoDium`, project number 5). It is shared with other repositories; only touch the items of this one.

- Every issue **must** be on the board, from the moment it is opened.
- Every pull request that has **no linked issue** must also be on the board. (A PR with a linked issue is tracked through its issue.)
- Every item on the board must have **all of its properties filled in**, with no empty field:

  | Field | Values |
  | --- | --- |
  | Status | Icebox, Backlog, In progress, Paused, Done, Cancelled |
  | Priority | P0 production-critical, P1 soon and visible, P2 next, P3 later, P4 low |
  | Size | XS, S, M, L, XL |
  | Category | Feature, Bug, Refactor, Config, Documentation |

  Assignees: the issue or PR is assigned to the owner (BSoDium). Set Status when you add the item and keep it current (new issue: Backlog; PR open: In progress; merged: Done; abandoned: Cancelled).
- Adding and filling an item:

  ```
  gh project item-add 5 --owner BSoDium --url <issue-or-pr-url> --format json   # prints the item id
  gh project field-list 5 --owner BSoDium --format json                          # field and option ids
  gh project item-edit --id <item-id> --project-id PVT_kwHOAssok84AhczX --field-id <field-id> --single-select-option-id <option-id>
  ```

- If you cannot reach the board (for example no `project` scope for `gh`, or GraphQL is blocked in your environment), say so explicitly in your final message and in the PR or issue description, so a human can finish it. Never claim the board is up to date when you could not check it.

## Content changes are not done until they are live

Content (places, entries, photographs) lives in the private-ish content repo (`BSoDium/Catalyst-content`); the site only changes when the standing pull request `content/publish` in THIS repo is merged. A content task therefore has four steps, and merging the content PR is only the second:

1. Open the content PR (`pnpm test` in the content repo passes; generated files regenerated as its docs say).
2. Merge it, after the owner's go.
3. **Find the standing PR**: `gh pr list --repo BSoDium/Catalyst --head content/publish`. Check it lists the change (the workflow updates it after the merge; if it is stale, say so).
4. **Report its number and state to the owner and ask for the go to merge it.** Never merge it unasked, never leave it unmentioned, and never say "done" or "published" while it is open.

If you cannot reach step 3 or 4 (no access, workflow failed), say which step is missing in your final message. A final message about content must name the `content/publish` PR (number, open or merged) and whether the change is live.

## Before finishing a task

1. The PR description has one closing keyword per issue, or `Refs` where the issue stays open.
2. The issue(s) or the PR are on the board, with every property filled in.
3. A content change was taken all the way to the `content/publish` PR (see "Content changes are not done until they are live"), and its state is reported.
4. Nothing above was skipped silently: report what you could not do.
