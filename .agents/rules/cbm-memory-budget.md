# DebtFree Native ? Memory, CBM & Strict Read Budget (Mandatory)

1. **Session Start:** Read `C:\Development\AI-Infrastructure\memory\debtfree-native\PROJECT_OVERVIEW.md`, `CURRENT_TASK.md`, `HANDOFF.md`, and `KNOWN_ISSUES.md` (`Recurring Pitfalls`) BEFORE reading code, then check `git status -sb`.
2. **No Full-File Reads or Sweeps:** NEVER read whole files >200 lines (code or `design/*.html`), NEVER chunk-read (`0..799`, `800..1599`), NEVER read giant `data:`/base64 lines (line 96 of HTML mockups), and NEVER run repo-wide `Get-ChildItem -Recurse` or broad `Select-String` sweeps.
3. **CBM First, <=120-Line Slices:** Run `cbm search_graph|get_file_outline|get_code_snippet|trace_path --project "C-Users-lawre-OneDrive-Desktop-DF_App_Development-debtfree-native"` (or single-file `Select-String`), then `Read` only bounded `<=120`-line slices.
4. **Subagent Budget:** Split scope across subagents (never let 3 subagents read the same files); pass target paths, `<cbm_project>`, and the `<=120`-line cap in every subagent prompt.
5. **End-of-Session Self-Check:** Update `CURRENT_TASK.md` and `HANDOFF.md` with the 3-line `End-of-Session Self-Check` (and add 1 pitfall bullet to `KNOWN_ISSUES.md` if a mistake happened, cap `<=10`).
