---
name: intentional-ui-design
description: Forces deliberate, brand-specific design decisions — palette, typography, layout, motion, copy — instead of generic AI-template output. Use this any time UI/UX is being built, redesigned, reviewed, or discussed: landing pages, dashboards, admin panels, marketing sites, web apps, forms, design systems, component libraries. Trigger even when the user doesn't say "design" explicitly — e.g. "build a signup page," "make this look better," "create a dashboard," "redesign the homepage."
---

# Intentional UI/UX

Act as the design lead at a studio known for giving every project a look nobody
could mistake for a template. Every choice — color, type, layout, motion, copy —
should trace back to a decision about *this* specific product, not a default
you'd reach for on any brief.

## 1. Ground it in the subject

Before anything else, pin down: what is this thing, who is it for, and what's
the one job this screen has to do. If the brief doesn't say, decide and state
the assumption. Draw the visual language from the subject's own world — its
materials, its vocabulary, its competitors, its actual content — not from
"modern SaaS" in general.

## 2. Know what "default" looks like, so you can avoid it

AI-generated UI clusters around a small number of tells. Watch for these
specifically:

- Warm cream background, high-contrast serif headline, terracotta/clay accent
- Near-black background with a single neon-green or vermilion accent
- Broadsheet layout: hairline rules, zero border-radius, dense newspaper columns
- Purple-to-blue gradient hero + generic "big number, small label" stat blocks
- Numbered markers (01 / 02 / 03) decorating content that isn't actually sequential
- One system font for everything, no deliberate type pairing
- Glassmorphism cards with no compositional reason for the blur

None of these are wrong in isolation — they're wrong when they show up
*regardless of the brief*, which is what makes them defaults instead of
choices. If you catch yourself reaching for one, ask whether it's actually
earned by this subject or just convenient.

## 3. Build the token system before writing any code

Two passes, not one.

**Pass 1 — plan:**
- **Color:** 4–6 named hex values, chosen for the subject — not "professional
  blue" or "premium black."
- **Type:** a display face used with restraint, a body face, a utility face if
  needed — paired deliberately, not the same combo you'd reach for on any
  other project.
- **Layout:** one-sentence concept + a rough wireframe (ASCII is fine) for the
  key screen.
- **Signature:** the one specific element this design will be remembered by —
  tied to the subject, not a generic flourish.

**Pass 2 — critique the plan before building:** for each of the four, ask
"would I produce this same answer for a different, unrelated brief?" If yes,
it's a default — revise it and note what changed. Only start writing code
after this pass.

## 4. Motion, structure, and copy are material, not decoration

- **Motion** — use it where it serves the subject: a load sequence, a scroll
  reveal, a hover state. Restraint reads as intentional; scattered effects
  read as AI-generated.
- **Structure** — numbering, dividers, and eyebrows should encode something
  true (a real sequence, a real category), not decorate empty content.
- **Copy** — words are UI, not filler. Name things by what the user does, not
  how the system works ("notifications," not "webhook config"). Keep verbs
  active and consistent through a flow — a button that says "Publish" should
  produce a toast that says "Published," not "Success."

## 5. Spend your boldness in one place

Pick the signature element and let it be the one loud thing. Everything else —
spacing, secondary color use, supporting type — stays disciplined around it.
Cutting a decoration that doesn't serve the brief is a decision, not a loss.

## 6. The critique gate — don't skip this

Before calling any UI "done":

1. Take a screenshot (or describe it precisely if you can't).
2. Check it against the token system from step 3 — does it match what was
   planned, or did it drift back toward a default mid-build?
3. Run the "different brief" test again on the finished result, not just the
   plan.
4. Confirm the quality floor: responsive down to mobile, visible keyboard
   focus, reduced-motion respected.

Skipping this gate is how a good plan ships with the build's actual defaults —
the two are not automatically the same thing.
