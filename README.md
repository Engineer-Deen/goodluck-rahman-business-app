# Good Luck Rahman Enterprise

Good Luck Rahman Enterprise is a Windows desktop business management application built with Electron. It is designed for sales and payment entry, inventory tracking, audit logging, owner profile management, and offline-friendly local data storage.

## Overview

This project delivers a modern desktop management system with:
- Secure owner login and registration
- Sales entry desk for quick transaction recording
- Payment processing and receipt tracking
- Inventory management and product selection
- Audit log history for accountability
- Dashboard analytics for daily, monthly, and yearly summaries
- Automatic update support via `electron-updater`
- Local data persistence using `electron-store`

## Features

- Clean, responsive Electron desktop UI
- Owner profile management with secure PIN unlock
- Sales and payment dashboards
- Transaction history and record viewing
- Inventory product management
- Built-in update checking and installer packaging

## Project Structure

- `src/` — application source files
- `src/index.html` — main UI shell and panels
- `src/main.js` — Electron app entry, window creation, auto-updater, IPC handlers
- `src/preload.js` — secure preload bridge for renderer and main process communication
- `src/script.js` — frontend state, login flow, sales/inventory logic, Firebase support stubs
- `src/styles.css` — app styling and theme
- `src/assets/` — static assets and icons
- `scripts/` — packaging and release helper scripts
- `package.json` — app metadata, dependencies, build configuration

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/<your-username>/business_data_entry.git
   cd business_data_entry
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run in development mode:
   ```bash
   npm run dev
   ```

## Build / Packaging

The project uses `electron-builder` for packaging:

- Build for Windows installer and archives:
  ```bash
  npm run build
  ```
- Create installer and portable builds:
  ```bash
  npm run dist:installer
  npm run dist:portable
  ```
- Package for distribution:
  ```bash
  npm run dist
  ```

## Release updates for Windows

- Build a Windows update release:
  ```bash
  npm run release:update:win
  ```

## Build Output Folders

- Windows packages will be placed in `package-output/win`

## Usage

- Start the app with `npm run dev`
- Register a new owner account or log in with existing credentials
- Use the navigation tabs to access the dashboard, sales entry, payment desk, records, inventory, and audit log
- Check for updates using the built-in update control

## Notes

- Data is stored locally via `electron-store` in the user data directory.
- Update feed configuration is handled through the app and can be customized with a valid URL.
- Firebase auth and Firestore integration is partially included for optional remote configuration.

## License

This project is licensed under the MIT License.
