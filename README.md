# KeyNotter (Simple)

A simple Electron teleprompter called KeyNotter.

## What it does

- Single-window workflow: teleprompter + controls in one window
- Camera-adjacent top strip mode
- Floating mode
- Draggable overlay panel
- Resizable from any side/corner
- Play/pause/reset controls and global hotkeys
- Load `.txt` and `.md` files as UTF-8 plain text
- Local autosave of settings + script state

## Requirements

- Node `22.x` (`.nvmrc` is included)
- Windows 11 target runtime

## Run

```bash
npm install
npm run simple
```

This opens one window containing:
- Teleprompter viewport
- Controls directly under the viewport

## Default hotkeys

- `Ctrl+Alt+Space`: Play/Pause
- `Ctrl+Alt+R`: Reset
- `Ctrl+Alt+Up`: Speed up
- `Ctrl+Alt+Down`: Slow down
- `Ctrl+Alt+Right`: Font size up
- `Ctrl+Alt+Left`: Font size down
- `Ctrl+Alt+M`: Toggle mode

## Notes

- Play/Pause resumes from current scroll position.
- Opacity slider uses percentage (100% is fully opaque).
- Manual resize forces floating mode so your custom size is preserved.
