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
2. **Import the project Excel:** use `Site Defects - Project Template.xlsx`. It has three sheets: Project (number and name), Units, and Defects (Component, Code, Defect).
3. **On site:** choose the unit and component. They stay selected until you change them. Use ‹ › to move to the next unit.
4. **For each condition,** tap **1** (defective), **0** (not defective), **NA** (doesn't exist at this unit) or **NR** (not able to be recorded). Tap the selected result again to clear it.
5. **Photos, either order:**
   - *Defect first:* tap **📷 Photo** on a condition. The photo is linked to that condition.
   - *Photo first:* tap the big **Photo** button. Afterwards, link the photo to a condition (**Link** or **Link + 1**), or keep it unlinked and take more. To review unlinked photos later, open **Unlinked**, select the best shot and link it.
   - Photos taken earlier with the iPhone Camera app can be added from **Menu → Add photos from library**.
6. **Notes:** each condition has a **Note** field. Each unit and component also has its own General notes box.
7. **Export:** creates a ZIP containing the spreadsheet plus `Photos/<Unit>/<Component>/` folders. Save it to Files, OneDrive or email. Unzip the ZIP and keep the spreadsheet next to the Photos folder; then the photo links open from Excel.

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

## Good habits

- Export **"Spreadsheet + new photos"** at the end of each site day. This is your backup. The app's data lives only on the phone, and deleting the app deletes it.
- Large photo sets are split into ZIP parts automatically. The part size is in Settings.
- If storage gets tight, choose **Settings → Photo size → Medium**.

## Updating the app

If the app code changes, upload the new files to the same repository and change `VERSION` in `sw.js`. Phones pick up the update the next time the app is opened with a connection.
