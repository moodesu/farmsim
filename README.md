# FS25 Hardcore Farm Planner

A lightweight static companion app for a 3-player Farming Simulator 25 hardcore co-op save.

Players:
- Don
- Mdgi
- Zakk

Default campaign:
- Moss Valley
- Blank-slate co-op start: no free pre-built farm assets
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
- Crop calendar and seasonal crop planner
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


## v4 crop recommender

The Crop Planner now ranks crops by selected month and goal (low cost, quick cash, or long-term value), while factoring in campaign stage and machinery recorded in the app. It remains fully static and uses browser localStorage.


## v5 update

- Campaign map changed to Moss Valley.
- Added Mods / DLC page with the 12 currently installed mods.
- Added stage-gating guidance for installed equipment/buildings/productions.
- Added Starter Camp Rule.
- Added Better Contracts availability rule with normal payouts only.
- Crop planner wording generalized to the seasonal FS25 crop calendar.


## Resetting for a new map/campaign

Use **Reset campaign** in the top-right controls to start fresh without changing the site's
Moss Valley configuration, player names, rules, or installed-mod reference list.

Before clearing the browser campaign state, the app automatically downloads a timestamped JSON
backup. You can restore that campaign later with **Import data**.

Reset data includes:
- cash, debt, farm value and land ownership state
- session details and tasks
- fields and crop plans
- machinery and planned purchases
- transactions
- progression milestones


## v7 map update

The campaign map is now **Moss Valley**.

The planner keeps:
- Don, Mdgi and Zakk
- the hardcore co-op rules
- the static/localStorage architecture
- dynamic crop planning
- mod/DLC tracking
- safe campaign reset with automatic JSON backup

Use **Reset campaign** after deploying v7 if you want a clean Moss Valley start.


## v8 — Supabase shared continuity

The planner now uses the `farmsim` Supabase project for shared persistent data.

### Access model
- Public visitors: read-only, no login required.
- Admin: Supabase email/password sign-in.
- Only users listed in `fs_admins` may write.
- The frontend uses the Supabase publishable key, which is safe to expose in a public client when RLS is configured correctly.

### Data model
- `fs_farm`
- `fs_tasks`
- `fs_fields`
- `fs_machines`
- `fs_purchases`
- `fs_transactions`
- `fs_crop_plans`
- `fs_milestones`
- `fs_mods`
- `fs_admins`

The old browser state remains cached in `localStorage` as an offline/emergency backup.

### First-time migration
1. Create the admin user in Supabase Auth.
2. Add that user's UUID to `fs_admins`.
3. Sign in through the site's **Admin** button.
4. Use **Push browser data** once to migrate the existing local campaign into Supabase.


## v9 — editable mod list

The Mods / DLC page now reads from `fs_mods` in Supabase. Public viewers can see the list. The authenticated farm admin can add and remove mods directly from the website, including category, stage gate, rule note and optional ModHub URL.
