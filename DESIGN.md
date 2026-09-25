# News Terminal design system

## Context and register
Product interface, not a landing page. Scene: sustained news reading at a Windows desk with one or more monitors. Dark theme is requested; contrast and hierarchy take priority over faux-terminal decoration.

## Composition
Top workspace tabs; left profile/section/topic/watchlist navigation; central row-based headlines; right detail/comparison pane; bottom refresh/availability status. AI, Technology, Stocks and Others are first-order reading controls, followed by legacy topic tabs. Dense but not tiny. Respect narrow detached windows with structural pane collapse. Controls remain reachable at 200% zoom.

## Typography
System sans-serif for titles, labels, and excerpts. Monospace/tabular figures only for timestamps, keyboard hints, and status metadata. Typical text 14–16px, secondary metadata no smaller than 12px. Prose line length at most 75ch. No display fonts or all-uppercase headings everywhere.

## Color
Use semantic OKLCH tokens for background, surfaces, foreground, muted text, borders, accent, danger, and focus. Near-neutral dark layers and one restrained functional accent. Meaning must not rely on color alone. Final implementation tokens in src/styles.css are the executable source of truth; verify measured contrast in browser.

## Components
Headlines are rows with title, publisher, age, kind, focused section, optional explicitly loaded thumbnail, and saved/read state, not nested cards. Controls have accessible labels and visible hover/focus/pressed/disabled states. Use restrained borders, consistent small radii, no decorative shadows/glass. Empty/error/loading states explain what happened and how to recover.

## Motion and keyboard
No animation for repeated keyboard navigation, tab switching, or search. Only short optional feedback for occasional surfaces; honor reduced motion. Never reorder the visible stream under the reader during background refresh. New-items affordance should preserve selected story and scroll.

## Verification
Check real screenshots at 1440x900, 1024x768, narrow detached sizes, and 200% zoom; long multilingual headlines; keyboard-only operation; reduced motion; offline, failed source, empty search, and unavailable AI. Do not claim native behavior from browser fixture tests.
