# Pear Programming Agent Instructions

## Project overview

Pear Programming is a real-time collaborative coding environment.

Core systems include:

- React and TypeScript frontend
- Monaco editor
- Yjs collaborative document synchronization
- Spring Boot backend
- WebSocket communication
- Redis Pub/Sub
- shared workspaces, files, chat, presence, and code execution

Preserve real-time collaboration behaviour when modifying frontend components.

## Working conventions

- Inspect existing components before creating replacements.
- Reuse current hooks and services where possible.
- Do not replace working functionality with mock data or placeholders.
- Do not perform broad rewrites unless explicitly approved.
- Keep components reasonably sized.
- Extract shared behaviour when it improves clarity, but avoid unnecessary abstraction.
- Preserve strict TypeScript types.
- Avoid `any` unless there is a documented reason.
- Keep accessibility and keyboard interaction in mind.

## UI direction

Pear Programming should feel like a calm, minimal coding tool with a little warmth. The editor and the code come first.

The visual language should use:

- light, warm cream surfaces everywhere, including the editor (light Monaco theme)
- flat panels separated by 1px borders, without card shadows
- muted pear green only for the Run button, active states, and the lead tag
- the existing rounded hand-drawn font for interface text, and monospace for code
- small icon buttons for secondary actions instead of large labelled buttons
- one-line empty states instead of illustrations
- the small pear logo as the only decoration
- restrained animation

The interface should remain professional and functional.

Avoid:

- decorative illustrations, background art, and textures
- large hero sections or marketing copy inside the app
- heavy shadows, gradients, and glows
- dark panels inside the light shell
- all-caps headings and loud status pills
- generic SaaS styling or neon colours
- decorative elements covering functional content
- fragile absolute positioning for main layout
- excessive animation

## Layout

- Use CSS Grid or Flexbox for major layout regions.
- Avoid overlapping panels.
- Panels should manage their own overflow.
- Monaco containers require valid minimum heights.
- Sidebars should be collapsible on smaller screens.
- Test at typical laptop and desktop widths.

## Testing

Before completing a phase, run the repository’s relevant:

- frontend tests
- backend tests when affected
- type checking
- linting
- production build

Add tests for keyboard-heavy interactive components.

## Git

Make reasonably sized commits.

Use normal commit messages such as:

- redesigned workspace layout
- improved room chat interactions
- added mention menu keyboard support

Do not use conventional commit prefixes such as `feat:` or `fix:`.
Do not use phase-number commit messages.

Stop after each requested implementation phase and summarize:

- files changed
- behaviour changed
- tests run
- known concerns