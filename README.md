# Student Task Manager (PWA)

A simple installable student task manager designed for GitHub Pages and PWA Builder.

## Files
- `index.html` — app interface
- `styles.css` — responsive styling and dark mode
- `app.js` — task/profile functionality
- `manifest.json` — PWA install information
- `sw.js` — offline app shell
- `icon.svg` — app icon

## Publish with GitHub Pages
1. Upload the **contents** of this folder to the root of your GitHub repository. `index.html` must be at the repository root, not inside another nested folder.
2. In GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Choose branch `main` and folder `/(root)`, then Save.
5. Wait for GitHub Pages to publish and open the website URL.

## Package with PWA Builder
1. Open https://www.pwabuilder.com/
2. Enter the published GitHub Pages URL.
3. Choose **Package for Stores → Android** and follow the packaging steps.

## Important notes
- Profiles are local convenience profiles, not secure online authentication. Do not use a real password or sensitive information.
- Data is saved in the browser's local storage on that device. Clearing browser data can erase tasks. Profiles do not sync between devices.
- Notification support depends on the browser, device settings, and whether the app/browser is allowed to run. This starter version asks permission but does not run a guaranteed background deadline scheduler.
- This project is a front-end PWA. It does not include cloud accounts, cross-device synchronization, or an AI quiz backend.
