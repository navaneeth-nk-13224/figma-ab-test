# Design AB Test — Figma Plugin

A Figma plugin that lets designers create shareable AB test links from two design variations. Share the link with teammates or stakeholders, let them vote on their preferred design, and view results right inside Figma.

## How It Works

1. **Select two frames** in Figma (your two design options)
2. **Run the plugin** → click "Create AB Test"
3. **Share the generated link** with voters
4. Voters see both designs side-by-side and **click to vote**
5. **View results** in the plugin under "My Tests"

## Project Structure

```
figma-ab-test/
├── plugin/              # Figma plugin
│   ├── manifest.json    # Plugin manifest
│   ├── code.js          # Plugin sandbox code
│   └── ui.html          # Plugin UI panel
├── server/              # Backend + voting page
│   ├── package.json
│   ├── index.js         # Express API server
│   └── public/
│       └── vote.html    # Shareable voting page
└── README.md
```

## Setup

### 1. Start the Server

```bash
cd server
npm install
npm start
```

The server runs at `http://localhost:3000` by default.

For production, set these environment variables:
- `PORT` — Server port (default: 3000)
- `BASE_URL` — Public URL of your server (default: `http://localhost:3000`)

### 2. Install the Figma Plugin

1. Open Figma → Plugins → Development → **Import plugin from manifest...**
2. Select `plugin/manifest.json` from this project
3. The plugin appears under Plugins → Development → **AB Test**

### 3. Configure Server URL

If your server is not running on `localhost:3000`, update the `SERVER_URL` constant at the top of `plugin/ui.html`.

## Usage

### Creating a Test

1. Select **exactly 2 frames** on your Figma canvas
2. Run the plugin: Plugins → Development → AB Test
3. Enter a title and optional labels for each option
4. Click **Create AB Test**
5. Copy the generated link and share it

### Viewing Results

1. Open the plugin
2. Switch to the **My Tests** tab
3. See vote counts and percentages for each test
4. Click **Refresh** to update results

### Voting (for recipients)

1. Open the shared link in a browser
2. Click on the design you prefer
3. Results are shown after voting

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/tests` | Create a new AB test |
| GET | `/api/tests/:id` | Get test details |
| POST | `/api/tests/:id/vote` | Cast a vote |
| GET | `/api/tests/:id/results` | Get vote results |

## Deployment

For sharing links outside your local network, deploy the server to a cloud provider:

- **Railway**: `railway up` from the `server/` directory
- **Render**: Connect your repo and set root directory to `server/`
- **Fly.io**: `fly launch` from the `server/` directory

After deploying, update `BASE_URL` env var and `SERVER_URL` in the plugin UI.

## Tech Stack

- **Plugin**: Figma Plugin API, vanilla HTML/CSS/JS
- **Server**: Node.js, Express, better-sqlite3
- **Storage**: SQLite (persistent, zero-config)
