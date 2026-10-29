# Site Defects — offline iPhone app

An installable web app for recording construction-defect observations on site. Everything is stored on the phone and works with no signal.

## Put it on your iPhone (one-time, about 10 minutes)

The app has to be served from a web address once, so Safari can install it. GitHub Pages is free and the simplest option.

1. Create a free account at github.com.
2. Create a new repository, for example `site-defects`. It can be public; it contains only the app, never your data.
3. Click **Add file → Upload files**. Drag in everything in this folder (`index.html`, `app.js`, `app.css`, `sw.js`, `manifest.webmanifest`, and the `vendor` and `icons` folders). Then click **Commit**.
4. Go to **Settings → Pages**. Under "Branch", choose `main` and `/ (root)`, then click **Save**. After a minute the page shows your address, for example `https://yourname.github.io/site-defects/`.
5. On the iPhone, open that address in **Safari**. Tap **Share → Add to Home Screen**.
6. Open the app from the Home Screen icon (not the Safari tab). From now on it works offline.

Each inspector does steps 5–6 on their own phone with the same address.

Netlify Drop (app.netlify.com/drop) also works: drag this folder onto the page and you get an address immediately.

## Using it

1. **First launch:** enter your initials.
2. **Import the project Excel:** use `Site Defects - Project Template.xlsx`. It has three sheets: Project (number and name), Units (Unit, Address, Schedule), and Defects (Component, Code, Defect).
3. **Schedule:** number units in the Units sheet's **Schedule** column (1, 2, 3…), or add a sheet named **Schedule** that lists units in visit order. Scheduled units appear first in the unit list, in that order. All other units follow underneath.
4. **On site:** choose the unit and component. They stay selected until you change them. Use ‹ › to move to the next unit in schedule order.
5. **Adding to the lists:** add a unit from the unit list (**+ Add unit**), a component from the component list (**+ Add component**), or a condition from the bottom of the condition list. Items from the import file are locked and can't be deleted. Items added on site can be deleted from **Menu → Edit lists**.
6. **For each condition,** tap **1** (defective), **0** (not defective), **NA** (doesn't exist at this unit) or **NR** (not able to be recorded). Tap the selected result again to clear it.
7. **Photos, either order:**
   - *Defect first:* tap **📷 Photo** on a condition. The photo is linked to that condition.
   - *Photo first:* tap the big **Photo** button. Afterwards, link the photo to a condition (**Link** or **Link + 1**), or keep it unlinked and take more. To review unlinked photos later, open **Unlinked**, select the best shot and link it. Unlinked photos belong to the unit, not the component: every component at that unit sees them, grouped by the component they were taken under (they never carry over to another unit). For example, roof photos taken while you were on Stucco can be linked later from Roofs. A photo linked to another component's condition moves into that component's folder, and the Photo Log's **Taken during** column records where it was taken. Photos taken at the wrong unit can be moved: in **Unlinked**, select one or more photos, tap **Move**, and pick the unit (scheduled units are listed first, and you can search). They become unlinked photos at that unit, under the same component, and export into that unit's folder. The Photo Log's **Moved from unit** column records where they were taken.
   - *Batches:* **Photos before linking** (– 1…10 +, above the camera button) sets how many photos you take before linking them all to one condition. You can change it at any time, including mid-batch.
   - **Video:** in the camera, swipe to **Video** (or tap the video icon) and record. Videos are named, sorted, linked and exported exactly like photos (for example `24-118_JM_20261028_0043.mov`) and share the same numbering. They're stored as recorded, so they use a lot of space: about 60–200 MB per minute.
   - Photos and videos taken earlier with the iPhone Camera app can be added from **Menu → Add photos & videos from library**.
   - **Built-in camera (trial):** switch between the iPhone camera and the built-in camera in **Menu → Camera** or **Settings**. Version 1.4.1 lays it out like the iPhone Camera app:
     - **Top bar:** flash on the left (tap once and it stays on), the options chevron in the middle, and **Done** on the right. The chevron drops an options panel down from the top: photos before linking, **Restart camera**, **Use iPhone camera**, and **Camera details** (which camera iOS opened, its resolution, whether it offers flash, and any startup error). While recording, a red timer replaces the chevron.
     - **If the viewfinder stays blank:** tap **Tap to start the camera** if it appears, or open the chevron and tap **Restart camera**. If it still won't start, send a screenshot of **Camera details**.
     - **Viewfinder:** the unit, component and linked condition across the top, and zoom buttons along the bottom (**.5**, **1×**, **2**, **Tele**, depending on the phone's lenses). Tap a zoom button to jump to it, drag sideways across the buttons to open the zoom wheel (as on the iPhone), then drag anywhere on the wheel to keep turning it, or pinch the viewfinder. Zoom is smooth from .5× up to 40× for photos. Beyond the iPhone's own zoom range (about 10× here), the extra zoom is digital, a crop of the picture. Video zooms as far as the iPhone's own zoom allows. The wheel and pinch catch briefly at .5, 1, 2 and the telephoto, with a light haptic tick on iOS 18 and later. The app uses iOS's combined back camera (the one the Camera app uses), and iOS switches between the ultra-wide, main and telephoto lenses itself as you zoom, without restarting the camera. The first time, the camera opens once more as it moves to the combined camera; after that it opens straight on it. Switching between Photo and Video also happens without reopening the camera. On phones that don't offer the combined camera, the app switches lenses itself, holding the last frame for a moment. Swipe left or right to switch between photo and video. Press and hold to lock focus, on phones that allow it (iPhone doesn't let web apps control focus, so it keeps focusing automatically).
     - **Bottom:** VIDEO / PHOTO, the shutter, the last capture on the left, and the batch progress ring on the right.
     - **Zoom:** iOS doesn't tell web apps the telephoto's magnification, so it's set under the chevron (**Telephoto lens: 2×–5×**). The app guesses from the screen size: 5× on 16 Pro sizes, 3× otherwise. Zoom between lenses in photos is digital (a crop), like the iPhone's 2×. In video, zoom moves straight to the nearest lens.
     - **Turning the phone:** like the iPhone Camera, the screen layout stays put while the controls turn to face you. The recording timer and the options chevron stay still. Photos and videos taken sideways come out landscape. The first time, iOS asks to allow **Motion & Orientation** access; allow it so the app knows which way the phone is held. This works with Portrait Orientation Lock on or off.
     - **Video shape:** video is taller than photos (16:9 versus 4:3), so in Video the picture runs the full width of the screen behind the controls, as it does in the iPhone Camera.
     - **Quality:** photos are frames from the camera feed (about 8 MP). They are not Live Photos. Videos are recorded at 1080p or 4K (set in Settings) and stop automatically at 5 minutes.
8. **Notes:** each condition has a **Note** field. Each unit and component also has its own General notes box.
9. **Export:** choose what to export (spreadsheet + photos, photos only, or spreadsheet only), which copies (sorted, unsorted, or both), and which photos (not yet exported, or all). **Sorted** puts renamed photos in `Photos/<Unit>/<Component>/`. **Unsorted** puts every photo in one `Unsorted/` folder with two sub-folders: `Original names/` and `Renamed/`. Unzip the ZIP and keep the spreadsheet next to the Photos folder; then the photo links open from Excel.

## Screen zoom

**Settings → Lock screen zoom** is on by default. Pinch and double-tap don't zoom the screen in or out, so the screen can't be zoomed by accident. Turn it off if you need to zoom the screen; it takes effect straight away and is remembered after you tap **Save**. The built-in camera's own pinch-to-zoom works either way.

## Photo names

`<Project#>_<Initials>_<YYYYMMDD>_<####>.jpg`, for example `24-118_JM_20261028_0042.jpg`.

The number restarts at 0001 each day for each inspector. The date is included so names never repeat across days. Deleted photo numbers are not reused.

## The spreadsheet

- **Unit Matrix:** units down the side and conditions across the top, the same layout as the paper form. Each 1/0 cell links to its proof photo. Totals and % defective are in the bottom rows and right-hand columns.
- **Summary:** for each condition, Defective (1), Observed (1+0), % defective, NA, NR and not-yet-recorded. These are live formulas.
- **Observations:** one row per unit and condition, with notes and a link to every proof photo. It is filterable.
- **Photo Log:** every photo, with its unit, component and the conditions it proves.

## Updating the defect list mid-project

Edit the Excel file and import it again with the same project number. Results and photos are kept wherever the unit name and defect text still match.

## Storage

- Photos are kept inside the app's private storage on the iPhone. They are not in the Photos app or iCloud Drive, and nothing is deleted automatically when a project ends.
- iOS decides how much space the app may use. It's a share of the phone's free space, so freeing space on the phone raises the limit. **Settings & storage** shows how much is used.
- After exporting, **Settings & storage → Free up space** removes the exported full-size photos from the phone. Thumbnails, results and links stay.
- When a project is finished and everything is exported and saved, delete it from **Menu → Projects**.

## Good habits

- Export **"Spreadsheet + new photos"** at the end of each site day. This is your backup. The app's data lives only on the phone, and deleting the app deletes it.
- Large photo sets are split into ZIP parts automatically. The part size is in Settings.
- If storage gets tight, choose **Settings → Photo size → Medium**.

## Versions and rolling back

Every version is saved, complete, in its own folder inside `site-forms_claude` on the Desktop (`v1.0.1`, `v1.1.0`, `v1.2.0`, `v1.3.2`, `v1.4.0`, `v1.4.1`, `v1.4.2`, `v1.4.3`, `v1.4.4`, `v1.4.5`, `v1.4.6`, `v1.5.0`, `v1.5.1`, `v1.6.0`, …). Each folder holds all 10 app files plus `VERSION.txt` describing what changed.

To go back to a version, upload **all 10 files** from that version's folder to GitHub (they replace the current ones), then open the app twice on each phone. Projects, results and photos on the phone are not affected. Versions before 1.3.2 don't have automatic updates, so after rolling back that far, phones may need an extra open or two to pick up later updates.

## Updating the app

When the app code changes, upload **all** the changed files together, at the top level of the repository (not inside a folder). Each version has a matching number in three places: `APP_VERSION` in `app.js`, `VERSION` in `sw.js`, and `app-version` in `index.html`.

From version 1.3.2 on, a phone with a connection picks up a new version automatically: open the app once, and it reloads itself into the new version. If the files on GitHub don't match each other (for example, one was missed in an upload), **Menu** shows a warning next to the version number. Phones pick up the update the next time the app is opened with a connection.
