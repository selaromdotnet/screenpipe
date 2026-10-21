# Starred session controls evidence

Before is recreated from `acc1e7ba0`. After is from `df81001e94fe8216dfee3ade2fd09e51a47b7d25`.

- Native images render the actual `ShortcutReminderView` and `ShortcutDisclosureView` from `apps/screenpipe-app-tauri/src-tauri/swift/shortcut_reminder.swift` through SwiftUI ImageRenderer. Both show an active session at overlay scale 2 and raster scale 2. After supplies 42 remaining minutes. The app icon comes from the repository. The transparent reserved disclosure area is omitted between the two real views.
- React images render the real `StarredTimeline`, `StarredSessionPanel`, and `CompactSessionControls` components, with product global styles, Tailwind configuration, Inter font, and synthetic session API responses. Default controls are static captures without the native dismissal command. History captures exercise the real `SessionHistory` list, including loading the second page and scrolling to it.
- React desktop viewport: 1280 pixels wide. The before/after images use matching 1280×500 crops. The narrow dark capture uses a 375×700 iframe viewport.
- These are isolated component renders, not screenshots of a running packaged desktop app. They do not prove native focus, Spaces, or compositor behavior. Temporary capture routes and fixtures are outside the patch.

Verification: 66 focused React tests, 190 Swift checks, three queued native Rust session tests, TypeScript. The generated coverage inventories were refreshed for a pre-existing stale database reader count, and coverage:all:check passes. No database code changed.
