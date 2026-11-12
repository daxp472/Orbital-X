# Orbital X v2.3.8 — Release Highlights

Welcome to **Orbital X v2.3.8**. This release introduces a breakthrough **Hybrid Portable Architecture**, a redesigned **Software Updates Suite** with native release highlights, an upgraded **Recent Conversations** manager, and a verified **Developer Diagnostic Suite**.

---

## 🌟 What's New?

### 1. Hybrid Portable Environment (Carry Your IDE on Any USB)
Orbital X now operates as a true portable workstation. Plug your USB drive into any machine (Windows, macOS, or Linux) and immediately code with your personalized environment:
- **What stays on your USB:** Your editor themes, font configurations, installed community skills, extensions, agent instructions, custom prompt shortcuts, and portable chat session history.
- **What each computer provides:** Local Ollama models, GPU acceleration, RAM, compilers (`cargo`, `tsc`, `python`), and system toolchains.
- **Dual-Safe Project Knowledge:** Project workspace memory stays right inside your project (`.orbital/`). You can optionally backup or sync project memory to your USB drive with 1 click, ensuring your project knowledge is never lost even if the USB drive is unplugged.

### 2. Polished Software Updates Suite & Native Release Viewer
- **Zero Raw Code Reports:** Internal development logs (`iteration.md`, `implementation.md`) are now strictly kept in engineering directories. You only see user-friendly, polished release highlights.
- **Native Markdown Viewer:** Enjoy beautifully rendered release notes directly inside the IDE with formatted typography, tables, and links.
- **Zero-False Update Prompts:** Resolved the version mismatch where installed versions prompted repeated upgrades. Installed versions are now dynamically verified against the native desktop binary.

### 3. Redesigned Recent Chats Interface
- **Clean Workspace History:** Replaced cluttered dropdowns with a sleek conversation drawer.
- **Instant Search & Filters:** Search conversations by title or message contents. Filter by active, pinned, or archived discussions.
- **Clean Vector Iconography:** Replaced emoji-based buttons with crisp SVG controls for pinning, archiving, exporting, and deleting conversations.

### 4. Fully Audited Developer & Diagnostic Suite
- Every control in Settings → Developer Options is now functional and verified against the native backend: live IPC round-trip latency benchmarks, kernel security simulation, state diagnostics copy, and clean cache purges.

---

## 🔄 What Changed?

- **Dynamic Version Verification:** Eliminated hardcoded version constants in frontend scripts. Orbital X now dynamically queries the desktop runtime core for absolute consistency across About, Settings, and Update checkers.
- **Crash-Safe Atomic Writes:** Portable preferences and chat sessions now utilize atomic temporary staging and automatic `.bak` recovery to prevent corrupted files if a USB drive is suddenly removed.
- **Apple HIG & Liquid Glass Aesthetics:** Removed emoji symbols across the updates pane, chat history, and developer tools in favor of unified vector SVG glyphs and typography.

---

## 🚀 How It Helps Your Daily Workflow

- **Seamless Computer Hopping:** Move from your home desktop to your office workstation or laptop by plugging in your USB. No reinstalling extensions, no reconfiguring preferences, and no re-typing agent prompts.
- **Zero Cloud Leakage:** All your portable configurations remain physically on your drive, while AI inference runs entirely on the host machine's hardware.
- **Clear Update Visibility:** You will always know exactly what version you are running, what is new in the latest release, and when an update is safely verified for installation.

---

## 💡 Why It Matters

Most developer tools require lengthy setup scripts, cloud synchronization accounts, or gigabytes of duplicated compiler runtimes. Orbital X v2.3.8 proves that an AI-native coding IDE can be completely portable, offline-first, and lightweight (~95 MB idle RAM) while leveraging the raw compute power of whichever computer you sit in front of.

---

## 👥 Who Benefits?

- **Multi-Device Engineers:** Developers who switch between home desktops, office workstations, and portable laptops.
- **Privacy-Conscious Coders:** Anyone who values physical offline control over their AI configurations, project memories, and chat history.
- **Offline & Air-Gapped Environments:** Developers working without reliable internet access or in secure offline labs.

---

## 🏷️ Release Status

- **Status:** **Latest Official Stable Release**
- **Architecture Support:** Windows x64 (`.exe`), macOS Apple Silicon (`.dmg`), Linux x64 (`.AppImage` / `.deb`)
- **Compatibility:** Fully backward-compatible with existing workspaces and v2.3.x projects.

