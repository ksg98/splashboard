# Shared UI primitives

Buttons, inputs, menus, dialogs, badges, chart wrappers: components that more
than one feature uses.

**Ownership:** this folder is empty until the visual design is chosen. It is
filled by the design-system step (the agent or person implementing the chosen
design), not by feature work. Feature agents import from here but do not edit
it; if a feature needs a new primitive, build it inside the feature folder and
propose moving it here.

Rules for anything added here:

- Style with Tailwind utilities backed by tokens (`bg-surface`, `text-fg`,
  `rounded-md`) or `var(--sb-*)`; never literal colours, radii or fonts.
- One component per file, named export, with a test next to it.
- No feature imports, no stores, no data fetching.
