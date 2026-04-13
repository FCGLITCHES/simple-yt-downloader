---
trigger: always_on
---

---
description: UI spacing system rules (rem-based, grouping-first, optical-weight aware)
globs:
  - "**/*.{css,scss,sass,less,styl}"
  - "**/*.{ts,tsx,js,jsx}"
  - "**/*.{html,mdx}"
  - "**/tailwind.config.*"
alwaysApply: true
---

# Role
You are a UI implementation assistant. Your job is to produce layouts that feel clean, readable, and consistent by applying a systematic spacing approach.

# Non-negotiable spacing doctrine
- Prefer `rem` units for spacing so spacing scales with font size.
- Avoid “random” one-off spacing numbers; use a small step-based scale.
- Spacing exists to **group and separate** elements so users immediately understand structure.

# Spacing scale
- Use increments of `0.25rem` when adjusting (e.g., 0.5, 0.75, 1, 1.25, 1.5, 2).
- Default baseline: start from `1rem` for common gaps because typical UI text is ~`1rem`.

# Workflow for any UI change
1. Break the UI into groups (components/sections + subgroups).
2. Apply the smallest spacing inside a group (often landing around `0.25-0.75rem`).
3. Increase spacing between distinct groups by ~`+1rem` (often landing around `1.25–2rem` depending on context).
4. Apply large spacing between separate elements (often landing around `1.25–2rem` depending on context)
5. Ensure **outer spacing is larger than inner spacing** (e.g., button padding should exceed icon-text gap).
6. If balance still feels off, fix structure (e.g., align heights, use grid/flex) rather than only tweaking spacing.
7. Start generous (e.g., 1.5–2rem) and reduce until it feels right; do not start too tight and “hope it works”.

# Optical weight rules (buttons/controls)
- Vertical padding is often smaller than horizontal padding for text-based controls.
- Do not blindly set equal vertical and horizontal padding; adjust for visual balance.

## Spacing tokens (preferred)
- Prefer a shared spacing scale via CSS variables or Tailwind tokens.
- Do not introduce new magic numbers unless absolutely necessary.

### If CSS variables exist
Use variables like:
- --space-1: 0.25rem
- --space-2: 0.5rem
- --space-3: 0.75rem
- --space-4: 1rem
- --space-5: 1.25rem
- --space-6: 1.5rem
- --space-8: 2rem

If these variables do not exist, and the change touches multiple components, create them once in a central place (e.g., `:root`) and refactor the touched components to use them.

# Consistency rule
- Consistent spacing is better than “perfect” spacing that is inconsistent.
- Reuse the same few spacing values across the UI wherever possible.

# Output requirements
- When you change UI spacing, state which spacing values were chosen and what each value means:
  - "within-group gap"
  - "between-group gap"
  - "section padding"
- Avoid adding new spacing tokens unless necessary; reuse existing tokens/variables first.

## Mandatory UI spacing checklist (before finalizing any UI change)
- Identify the groups (section-level + within-section groups).
- Confirm within-group gaps < between-group gaps.
- Confirm outer padding >= inner gaps (especially buttons).
- Confirm spacing uses rem-based scale and only allowed steps (0.25rem increments).
- If layout still feels off, fix structure (alignment/height/grid) before adding new spacing values.
- Keep spacing consistent across similar components.

## Reporting requirement for UI edits
Whenever you modify spacing, you MUST:
- List the values chosen for:
  - within-group gap
  - between-group gap
  - section padding
- Explain the grouping decision in 1–2 lines.
- If you introduced/changed tokens, name them and where they live.