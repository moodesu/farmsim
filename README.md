# FS25 Hardcore Farm Planner

A lightweight static companion app for a 3-player Farming Simulator 25 hardcore co-op save.

Players:
- Don
- Mdgi
- Zakk

Default campaign:
- No Ones Land 4X
- One shared farm
- $1,000 total starting cash
- No land, vehicles, buildings, livestock or loans
- Hard economy
- 3-day months
- 5x normal timescale

## Features

- Shared farm dashboard
- Session task board
- Player assignment
- Field / parcel tracking
- Machinery inventory
- Purchase wishlist
- Farm finance ledger
- Stage-based progression
- Full hardcore ruleset
- JSON export / import
- Browser persistence via localStorage

## Run locally

Open `index.html` directly, or run any static web server:

```bash
python -m http.server 8080
```

Then visit http://localhost:8080

## Deploy to Netlify

This is a static site. Drag the folder into Netlify or connect it to a Git repository.
No build command is required.

## Data

v1 stores data only in the current browser's localStorage.

Use **Export data** to save a JSON backup and **Import data** to move it between browsers.

For true shared live data between Don, Mdgi and Zakk, the next step is Supabase authentication + realtime database storage.
