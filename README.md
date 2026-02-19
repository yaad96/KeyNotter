# KeyNotter

KeyNotter is an Electron desktop teleprompter designed for real presentations: one focused window with the script and controls together.

## Features

- Single-window teleprompter workflow
- Always-on-top overlay behavior
- Two display modes:
  - `top_strip` for camera-adjacent positioning
  - `floating` for free placement
- Prompt viewport is manually scrollable so you can jump to any section
- Play/Pause resumes from current position
- Reset returns prompt position to the top
- Speed control with fixed `10`-unit steps (`0` means no motion)
- Font size controls
- Opacity control (`100%` is fully opaque)
- Top offset control for strip placement
- Window movement by dragging in the prompt area
- Window resizing from all edges and corners
- Global hotkeys
- Load script files from local disk (`.txt`, `.md`, UTF-8)
- Local autosave of settings and last script state

## Requirements

- Node `22.x` (`.nvmrc` included)
- Windows 11 target runtime

## Run

```bash
npm install
npm start
```

## Hotkeys

- `Ctrl+Alt+Space`: Play/Pause
- `Ctrl+Alt+R`: Reset
- `Ctrl+Alt+Up`: Speed up
- `Ctrl+Alt+Down`: Slow down
- `Ctrl+Alt+Right`: Increase font size
- `Ctrl+Alt+Left`: Decrease font size
- `Ctrl+Alt+M`: Toggle mode (`top_strip` / `floating`)

## Notes

- Manual scrolling sets the current playback position.
- Playback continues from wherever you manually positioned the script.
- Resizing and drag-move behavior are optimized for live presentation adjustments.
