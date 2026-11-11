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

**App icon** (from 1.10.11): the SGH logo, in its reverse version (white with the gold diamond), taken unaltered from the SGH Brand Guidelines with its clearspace, on the SGH green gradient (rebuilt from the guidelines' colours; the official gradient file is at sgh.com/brand). From 1.10.12 each icon design has its own file names (`icon-sgh-gradient-180/192/512.png`): Safari remembers Home Screen icons by file name, so reusing a name kept giving the old icon when adding to the Home Screen.

**Choosing the icon** (from 1.10.13): when the app's address is open in a Safari tab, the yellow banner has a **Choose Home Screen icon** button. Pick one of eight icons: the SGH logo or a clipboard-and-camera mark (from 1.10.14), each on four SGH backgrounds (green gradient; charcoal; gradient with pattern; pattern with mint glow). The default is the SGH logo on the green gradient. Then tap **Share → Add to Home Screen**; the preview there shows the chosen icon. The choice only applies when adding the app to the Home Screen: an installed app keeps its icon, and changing it means removing the app (which deletes its projects and photos) and adding it again. 1.10.10 used plain SGH charcoal and 1.10.9 a clipboard-and-camera icon. iPhones keep the icon a Home Screen app was installed with, so phones that already have the app keep the old icon. Don't delete the Home Screen app just to change its icon: that deletes every project and photo on the phone. Re-add it only once everything is exported and combined (or leave the old icon; the app itself updates normally).

Netlify Drop (app.netlify.com/drop) also works: drag this folder onto the page and you get an address immediately.

## Using it

1. **First launch:** enter your initials.
2. **Import the project Excel:** use the template (**Menu → Get the Excel template**). It has four sheets: Project (number, name and Roofs), Units (Unit, Address, Schedule), Defects (Component, Code, Defect) and Buildings (Building, Description, Schedule; only used when roofs are recorded by building). Project numbers are `######.##`, for example `267180.00`, or with a 4-character identifier for older projects, for example `267180.00-RENO`. If Excel turns `267180.00` into `267180`, the app puts the `.00` back. The app warns, but still accepts it, if a number doesn't fit either format.
   - **Roofs by unit or by building** (from 1.9.0): the Project sheet has a **Roofs** row, `By unit` or `By building`.
     - **By unit** (the default, also when the row is missing and there's no Buildings sheet): every component, including the roof, is recorded at each unit, as before.
     - **By building:** add a sheet named **Buildings** with a **Building** column (optional **Description** and **Schedule** columns), listing the buildings in the order to show them, for example in random-selection order. Units and buildings are then completely separate: a **Units | Buildings** switch at the top of the screen changes between them, and each has its own list, search, ‹ › stepping and position. Buildings offer only the roof component; units offer every component except the roof. The roof component is the one named **Roof** (or Roofs, Roofing). To use another component, add a **Recorded at** column to the Defects sheet and put **Building** in that component's rows.
     - A building can't have the same name as a unit, and no unit can be named `Buildings`. The app refuses the file and says why.
     - If there's a Buildings sheet but no Roofs row, the app records roofs by building. If Roofs says `By unit`, the Buildings sheet is ignored, and the app says so when you import.
   - **Answers and items** (from 1.10.0): four optional columns on the Defects sheet.
     - **Answer:** blank for 1 / 0 / NA / NR, or **Number** (a measurement or count), **Text** (e.g. an AAMA rating) or **Choice** (pick from a list).
     - **Choices:** the options for a Choice, separated by commas, editable in Excel. Put **Other** at the end of the list to allow a typed answer.
     - **Units:** shown next to a Number, e.g. `in.`. Numbers can be typed in any format (41.5, 41 1/2, 41-1/2", 3'-6"); the spreadsheet gets decimals, in inches when feet are used.
     - **Multiple:** **Yes** on a component's rows gives one form per item, for windows and doors: on site, **+ Add** creates Window 1, Window 2… at each unit, each with its own results, notes and photos.
     - Door types are separate components (Entry Door, Sliding Glass Door, Patio Door); list only the ones the project has.
3. **Schedule:** in the Units sheet's **Schedule** column, put each unit's visit day and time, for example `Mon 11/16 8:00 AM` (from 1.10.8; an Excel date-time cell works too, and the day name and year are optional), or number the units (1, 2, 3…). Or add a sheet named **Schedule** that lists units in visit order. Scheduled units appear first in the unit list, earliest first, with the day and time under each one ("Scheduled Mon 11/16 8:00 AM") and at the top of the unit's screen. All other units follow underneath.
4. **On site:** choose the unit and component. In the unit and building lists (and when moving photos), the search box stays at the top while the list scrolls (from 1.10.5). They stay selected until you change them. Use ‹ › to move to the next unit in schedule order.
5. **Adding to the lists:** add a unit from the unit list (**+ Add unit**), a component from the component list (**+ Add component**, with an option for one form per item), or a condition from the bottom of the condition list (with an answer type: 1/0/NA/NR, Number or Text). Items from the import file are locked and can't be deleted.
   - **Editing and deleting what was added on site** (from 1.10.0): an added condition shows **Added on site · Edit** in its title, and an added component has **Edit** in the component list (also in **Menu → Edit lists**). Edit renames it or changes its code; **Delete…** asks first and says what will be lost. Photos are never deleted: photos linked to a deleted item go back to Unlinked. Renaming a component renames its photo folder, so its photos are exported again (the Combine page removes the old copies).
   - **Windows and doors:** the bar above the list shows the current item (**Window 2**, 2 of 5) with **‹ ›** and **+ Add**. Tap the item's name to list them all, rename one or delete one (photos go back to Unlinked). Inspect items in the same order at every unit: inspectors' Window 3s are matched when combining.
6. **For each condition,** tap **1** (defective), **0** (not defective), **NA** (doesn't exist at this unit) or **NR** (not able to be recorded). Tap the selected result again to clear it. For a Number or Text condition, type the answer (a Number shows its decimal value beside it); for a Choice, tap the option (or **Other** and type it). NA and NR are always there; choosing one clears the typed answer. A recorded answer turns the condition's left edge **blue** (like red for 1, green for 0, grey for NA and orange for NR), so conditions still to fill in stand out. When linking a photo (photo first, or from the photo viewer), a typed condition offers **Link** or **Link + answer** instead of Link + 1: Link + answer links the photo and then asks for the count, measurement or answer (Skip leaves it as it was).
7. **Photos, either order:**
   - *Defect first:* tap **📷 Photo** on a condition. The photo is linked to that condition.
   - *Photo first:* tap the big **Photo** button. Afterwards, the link page opens: link the photo to a condition (**Link** or **Link + 1**), or keep it unlinked and take more.
   - **The link page** (from 1.11.0; "5 photos saved — link them?", and **Link…** in Unlinked):
     - The photos are a grid at the top (**Small / Medium / Large**) that stays put while the conditions scroll underneath. Tap **⤢** on a photo to see it full screen.
     - **Different photos to different conditions:** tap photos to choose which ones the next Link applies to (all are chosen to start with; photos not chosen are dimmed). For example, with 5 photos: tap three to leave two chosen, tap **Link** on the first condition, and the app moves the choice on to the three photos not linked yet; tap **Link** on the second condition. The page closes by itself once every photo is linked. **All / None** and **Not linked yet** change the choice quickly, and sliding a finger across photos chooses several.
     - **The same photos to several conditions:** tick **Link to more than one condition**. The page then stays open after each Link, with the same photos chosen, until you tap **Done**. The app remembers the tick.
     - A photo shows **🔗 2** when it's linked to two conditions, and each condition shows how many of these photos it has. A condition the chosen photos are already linked to shows **✓ Linked**: tap it to unlink them again. To review unlinked photos later, open **Unlinked**, select the best shot and link it. Unlinked photos belong to the unit, not the component: every component at that unit sees them, grouped by the component they were taken under (they never carry over to another unit). For example, roof photos taken while you were on Stucco can be linked later from Roofs. A photo linked to another component's condition moves into that component's folder, and the Photo Log's **Taken during** column records where it was taken. Photos taken at the wrong unit can be moved: in **Unlinked**, select one or more photos, tap **Move**, and pick the unit (scheduled units are listed first, and you can search). When roofs are recorded by building, buildings are listed after the units, so a roof photo taken from a unit can be moved to its building and linked there. They become unlinked photos at that unit, under the same component, and export into that unit's folder. The Photo Log's **Moved from unit** column records where they were taken.
   - **Full-screen preview** (from 1.10.3): tap the **⤢** corner of a photo in **Unlinked**, the link page or the **Link unlinked** picker to see it full screen. Pinch or double-tap to zoom in (up to 8×), drag to look around, swipe or use **‹ ›** for the next photo, and tap **Select** to pick it for linking or moving. From 1.11.0 the photo follows your finger as you swipe, a strip of small photos along the bottom jumps straight to any photo, and each photo appears at once (a small copy first, sharpening a moment later).
   - **Photo size** (from 1.10.6): **Small / Medium / Large** at the top of **Unlinked** and the **Link unlinked** picker; Medium shows 3 photos a row and Large 2. The app remembers the choice. Photos taken from 1.10.6 on have sharper thumbnails (480 px instead of 320 px). From 1.10.7, Medium and Large show each whole photo, never stretched or cropped. From 1.11.1 each tile is the photo's own shape (portrait or landscape) rather than a square, the blue selection outline goes all the way round it, and the tiles resize straight away when the size is changed.
   - **Selecting several photos** (from 1.10.4): in **Unlinked** and the **Link unlinked** picker, put a finger on a photo and slide sideways, then up or down to take in whole rows, like the iPhone Photos app. Every photo you pass over is selected (or deselected, if the first one was already selected). A swipe that starts up or down still scrolls; a tap still toggles one photo.
   - **Deleting a photo** (from 1.11.0): a photo can be deleted only while its batch is still open, that is, before you leave the link page for that batch.
     - *In the built-in camera:* tap the last photo (bottom left) to look through the photos taken in this batch, full screen. **Delete** is at the top; tap it twice. The batch count goes down by one, so you can retake the photo.
     - *On the link page straight after taking photos:* tap **⤢** on a photo, then **Delete** twice. (With the iPhone camera, the same works on the "Photo 2 of 5 saved" panel between photos.)
     - Photo numbers stay consecutive: when a photo is deleted, the later photos in the batch move down one number (delete 0042 and 0043 becomes 0042), exactly as if the deleted photo had never been taken.
     - Once the link page is closed, the photos are permanent, as before (from 1.10.3): a photo taken by mistake then simply stays unlinked. Photos already in **Unlinked**, exported photos and photos added from the library can never be deleted.
   - *Batches:* **Photos before linking** (– 1…10 +, above the camera button) sets how many photos you take before linking them all to one condition. You can change it at any time, including mid-batch.
   - **Video:** in the camera, swipe to **Video** (or tap the video icon) and record. Videos are named, sorted, linked and exported exactly like photos (for example `267180.00 2026-10-28 JJM 0043.mov`) and share the same numbering. They're stored as recorded, so they use a lot of space: about 60–200 MB per minute.
   - Photos and videos taken earlier with the iPhone Camera app can be added from **＋ Library** at the bottom of the main screen (from 1.11.1) or **Menu → Add photos & videos from library**. From 1.10.7 the app frees memory after each photo and keeps converted photos under 16 megapixels (the iPhone browser's limit), so a few hundred can be added in one go. A photo that still can't be read is offered to save to Files, never stored empty. For very large batches (500+), add them in a few rounds of 200–300.
   - **Built-in camera:** turn it on or off with the **Built-in camera** switch in the **Menu** (green = on; off means the iPhone camera is used), or in **Settings**. Version 1.4.1 lays it out like the iPhone Camera app:
     - **Top bar:** flash and Night mode on the left (below), the options chevron in the middle, and **Done** on the right. The chevron drops an options panel down from the top: photos before linking, **Restart camera**, **Use iPhone camera**, and **Camera details** (which camera iOS opened, its resolution, whether it offers flash, and any startup error). While recording, a red timer replaces the chevron.
     - **If the viewfinder stays blank:** tap **Tap to start the camera** if it appears, or open the chevron and tap **Restart camera**. If it still won't start, send a screenshot of **Camera details**.
     - **Viewfinder:** the unit, component and linked condition across the top, and zoom buttons along the bottom (**.5**, **1×**, **2**, **Tele**, depending on the phone's lenses). Tap a zoom button to jump to it, drag sideways across the buttons to open the zoom wheel (as on the iPhone), then drag anywhere on the wheel to keep turning it, or pinch the viewfinder. Zoom is smooth from .5× up to 40× for photos. Beyond the iPhone's own zoom range (about 10× here), the extra zoom is digital, a crop of the picture. Video zooms as far as the iPhone's own zoom allows. The wheel and pinch catch briefly at .5, 1, 2 and the telephoto, with a light haptic tick on iOS 18 and later. The app uses iOS's combined back camera (the one the Camera app uses), and iOS switches between the ultra-wide, main and telephoto lenses itself as you zoom, without restarting the camera. The first time, the camera opens once more as it moves to the combined camera; after that it opens straight on it. Switching between Photo and Video also happens without reopening the camera. On phones that don't offer the combined camera, the app switches lenses itself, holding the last frame for a moment. Swipe left or right to switch between photo and video. Press and hold to lock focus, on phones that allow it (iPhone doesn't let web apps control focus, so it keeps focusing automatically).
     - **Flash** (from 1.12.0): each tap of the lightning bolt moves to the next setting, **Off → Flash → Always on → Off** (from 1.12.1; a message names the setting). The app remembers the choice.
       - **Flash** (yellow bolt): the light comes on for a moment as each photo is taken, then goes off; each photo takes about half a second longer while the camera adjusts to the light. In Video, the light is on while recording.
       - **Always on** (yellow flashlight): the light stays on while the camera is open, handy for looking around a dark space.
       - iOS lets web apps use only the iPhone's light (the flashlight), not a true camera flash, so a "flash" photo is lit the way a flashlight lights it. The light only works on the main lenses; if the bolt is dimmed, change the zoom to 1×.
     - **Night mode** (from 1.12.0): each tap of the moon moves to the next setting, **Off → 1 s → 2 s → 3 s → Off** (from 1.12.1; the moon turns yellow and shows the time). Each photo then collects every frame the camera delivers over that time and combines them into one brighter photo with much less grain, like the iPhone's Night mode. Hold the phone still until the **Hold still** bar fills (leaning it on something helps); small hand movement is corrected automatically, and a few pixels at the edge are trimmed, as far as the phone moved. Night photos are up to about 8 MP. It's for photos only, it can be combined with Flash, and the app remembers the setting, so switch it off when you're back in the light.
     - **Bottom:** VIDEO / PHOTO, the shutter, the last capture on the left, and the batch progress ring on the right. Tap the last capture to look through this batch full screen (and delete a photo taken by mistake, from 1.11.0).
     - **Zoom when the camera opens** (from 1.12.0): the camera opens at 1×, like the iPhone Camera. To have it open at the zoom you last used instead, turn on **Settings → Built-in camera keeps its zoom**.
     - **Zoom:** iOS doesn't tell web apps the telephoto's magnification, so it's set under the chevron (**Telephoto lens: 2×–5×**). The app guesses from the screen size: 5× on 16 Pro sizes, 3× otherwise. Zoom between lenses in photos is digital (a crop), like the iPhone's 2×. In video, zoom moves straight to the nearest lens.
     - **Turning the phone:** like the iPhone Camera, the screen layout stays put while the controls turn to face you. The recording timer and the options chevron stay still. Photos and videos taken sideways come out landscape. The first time, iOS asks to allow **Motion & Orientation** access; allow it so the app knows which way the phone is held. This works with Portrait Orientation Lock on or off.
     - **Video shape:** video is taller than photos (16:9 versus 4:3), so in Video the picture runs the full width of the screen behind the controls, as it does in the iPhone Camera.
     - **Speed** (from 1.12.0): the shutter is ready again as soon as a photo is taken; photos finish saving in the background, in order, and the newest one shows in the bottom-left corner straight away. After **Done** or a full batch, the camera keeps running for 45 seconds with nothing on screen (iOS shows its green camera dot), so **Take another** or the **Photo** button opens it instantly. It's released at once if you leave the app or switch to the iPhone camera.
     - **Hardware buttons:** iOS doesn't let web apps use the volume buttons or the Camera Control button, so those can't take photos here (Camera Control opens the iPhone's own Camera app). A Bluetooth keyboard, or a Bluetooth camera remote that sends Enter or Space, does work the shutter (from 1.12.0).
     - **Quality:** photos are frames from the camera feed (about 8 MP). They are not Live Photos. Videos are recorded at 1080p or 4K (set in Settings) and stop automatically at 5 minutes or about 300 MB, whichever comes first. While recording, the timer shows how much time is left.
8. **Notes:** each condition has a **Note** field. Each unit and component also has its own **General notes & photos** box at the bottom of the list.
   - **General photos** (from 1.9.1): for photos that belong to the unit and component but don't prove one particular condition (overview or context shots, for example). Tap **📷 Photo** in the General notes & photos box, or **Link unlinked** there, or choose **General photo** at the top of the list after taking a photo with the big button. General photos leave the Unlinked tray, export into that component's folder, appear on the "General notes & photos" row of the Observations sheet, and are marked "General photo" in the Photo Log. To undo, open the photo and tap **Unlink**.
9. **Export:** choose what to export (spreadsheet + photos, photos only, or spreadsheet only), which copies (sorted, unsorted, or both), and which photos (not yet exported, or all). **Sorted** puts renamed photos in `Photos/<Unit>/<Component>/` (building photos in `Photos/Buildings/<Building>/<Component>/`). From 1.9.2, photos not linked to anything are loose in `Photos/<Unit>/` instead. When a photo's folder changes after it was exported (it's linked, unlinked or moved to another unit), it's exported again into its new folder, and the Combine page removes the old copy. **Unsorted** puts every photo in one `Unsorted/` folder with two sub-folders: `Original names/` and `Renamed/`. Unzip the ZIP and keep the spreadsheet next to the Photos folder; then the photo links open from Excel.
   - **ZIP size:** set in **Settings → Export part size**, from 250 MB up to 10 GB (2 GB by default). The ZIP is built from the files already on the phone, so big parts don't run the phone out of memory. When you save a ZIP, iOS briefly needs free space about the size of the ZIP. Each copy counts: with Sorted + Unsorted, one 7 MB photo adds about 21 MB, so a 10 GB ZIP holds about 480 photos.
   - **Spreadsheet:** named `<Project#> <YYYY-MM-DD> <Initials> Defects.xlsx`, for example `267180.00 2026-10-29 JJM Defects.xlsx`. Later exports the same day have the same name; the PC combine tool keeps only the newest one for each inspector.
   - **Combining on the PC:** use the combine tool (below) rather than unzipping by hand.
   - **Saving the ZIP:** when an export is ready:
     1. Tap **Download**. The iPhone copies the file, then shows a preview of the ZIP. For big ZIPs this takes a while (about 10 seconds per GB; 30–45 seconds for 5 GB). Meanwhile the app shows **Wait for the preview…** with a countdown, and its buttons are locked so nothing moves on early.
     2. Tap the **share button** (the square with an arrow) at the bottom left of the preview.
     3. Choose **Save to Files** (or **OneDrive**) and pick the folder.
     4. Tap **✕** at the top left to come back to the app.
     5. Answer **Did it save?** It unlocks when you come back from the preview (or when the countdown ends). If the preview never appeared, tap **Download again**. The next part only starts after you answer.

     This works at any size. In a Home Screen app, iOS always shows this preview instead of saving straight to Downloads (Apple treats it as intended behaviour), so the share-button step can't be skipped. **Share…** opens the share sheet directly, but only for files up to 400 MB: the share sheet loads the whole file into memory, and bigger files make the app close.
   - **ZIP names:** `<Project#> <YYYY-MM-DD> <Initials> <Export|Sorted|Unsorted|Photos> <HHMMSS>.zip`, plus `part 1 of 3` when an export is split, for example `267180.00 2026-10-29 JJM Export 121503 part 1 of 3.zip`. (From 1.14.0 the time has seconds, so two exports in the same minute can't replace each other in Files.)
   - **Did it save?** After each Download or Share, the app asks whether the file arrived. Only **Yes** marks those photos as exported. If you tap **Not sure**, they stay unexported and go into the next export.
   - A single video bigger than the ZIP part size goes into a ZIP part of its own.
   - **Checked files** (from 1.13.1): each file's checksum in the ZIP is worked out from the copy actually stored on the phone, and each photo is stored as one plain file, so the iPhone's Files app can always open the ZIP. (In 1.12.0–1.13.0 a ZIP could fail to open on the iPhone with "The operation couldn't be completed. Bad message".) **Settings → Photo check** shows how many stored photos have been checked. A ZIP from 1.12.0–1.13.0 that won't open on the iPhone can still be used on the PC with the Combine page, which doesn't need the checksums; or export those photos again with **All photos** selected.
   - **Defective conditions missing photos:** if any condition is marked 1 with no photo, the Export panel says how many. Tap it for the list; tap a row to go straight to that unit, component and condition. A bar at the bottom then shows **No photo: 1 of 5** with **Next ›** to step through the rest. The same list is in **Menu → Defective conditions missing photos**, which is shown in red whenever there are any.

## Combining exports on the PC: the Combine page

**https://jmoberlychan.github.io/site-forms/combine.html**, opened in **Microsoft Edge or Google Chrome** on the PC, combines every inspector's exports into one folder per project and builds the **combined project spreadsheet**. It runs entirely on the PC: the page reads and writes the folders you choose, and nothing is uploaded.

1. Copy everyone's export ZIPs (and any spreadsheet-only exports, `… Defects.xlsx`) into one incoming folder on the PC, for example `C:\Inspections\Incoming`.
2. **Close the combined spreadsheet in Excel** if it's open.
3. Open the Combine page and choose:
   - **Folder with the new ZIPs:** the incoming folder (optional; leave it empty to just rebuild the combined spreadsheet, for example after resolving conflicts).
   - **Where the combined project folder lives:** the folder that holds the project folder, for example `I:\Projects\267180.00` or `C:\Inspections`. `267180.00 Inspection` is created inside it. **Always use the same place for a project.**
   - **Also copy the receipt to (optional):** a shared OneDrive or Teams folder, so inspectors can load the newest receipt themselves on their iPhones.

   The page remembers these folders. The first time, and occasionally afterwards, Edge asks for permission to view and save changes in them: allow it.
4. Click **Combine** and keep the tab open until it says **Done**.

Each run:
- Unpacks the ZIPs into one `Photos\Unit\Component` tree (plus `Unsorted`, if exported). Files already there are skipped; photos are never overwritten (if two different photos have the same name, both are kept).
- Keeps one copy of each photo (from 1.9.2). If a photo changed folder after it was exported (for example, exported loose in the unit folder, then linked to a Stucco condition and exported again), the older copy is removed. The newest record decides where each photo belongs: each export ZIP includes a small file in the project's `Photo index` folder listing where it put each photo, and each inspector's newest spreadsheet says the same. A copy is only removed if it has the same name and size as the copy in the right place.
- Keeps the newest spreadsheet for each inspector beside the Photos folder and removes their older ones (they're still inside the original ZIPs). Spreadsheet-only exports (`.xlsx`) are filed the same way, even if they were renamed.
- Rebuilds `<Project#> Combined Defects.xlsx` from scratch from each inspector's newest spreadsheet.
- Writes a **receipt** listing every photo in the project folder (in `Receipts`, and in the optional shared folder).

Run it whenever ZIPs arrive, as often as you like: you don't need everyone's ZIPs first. Spreadsheets exported before app version 1.8.0 can't be combined (they lack the data the page reads); export again from 1.8.0.

`Combine Site Defects exports.cmd` (double-click) still works as a backup for unpacking ZIPs and writing the receipt, but it doesn't build the combined spreadsheet.

## The combined project spreadsheet

- **Same sheets as an inspector's spreadsheet** (Unit Matrix, Summary, Observations, Photo Log, Change Log, About), built from every inspector's newest results, with photos from everyone linked to each condition. Observations shows who recorded what (`JJM: 1; ABC: 0`) and everyone's notes, prefixed with their initials.
- **Conflicts:** where inspectors recorded different results for the same unit and condition, the result is left **blank** and the cell is **highlighted** (yellow with a red border) in the Unit Matrix and Observations. The Summary has an **Unresolved conflicts** column, so totals never count a disputed result.
- **Conflicts sheet:** one row per conflict: each inspector's result and time, everyone's notes, the photos, a **Go to cell** link to the highlighted cell, and a **Resolved result** column. To resolve, type **1, 0, NA or NR** in Resolved result, save, and run Combine again (no ZIPs needed): the result goes into the Unit Matrix, highlighted green. Resolutions are kept on every later run. If an inspector later changes one of the disputed results, the conflict is raised again, with a note.
- **Don't edit results directly in the combined spreadsheet**: it's rebuilt on every run. Change results in the app, or resolve conflicts on the Conflicts sheet.
- **Change Log:** every inspector's change log merged, newest first. Changed and Removed entries are highlighted. Filter on **Change** to see only those.

## Change log in each inspector's spreadsheet

Each time a spreadsheet is exported, the app compares every result, note and photo link with the previous spreadsheet export and adds what's different to the **Change Log** sheet: when, inspector, unit, component, condition, what (Result, Note or Photo), the change (**Added**, **Changed** or **Removed**), and the old and new values. The log is cumulative, so the newest spreadsheet carries the whole history. It's long but filterable. Changes made and undone between two exports don't appear.

## Clearing space on the phone automatically

On the iPhone, save the receipt to Files (or open it straight from the shared OneDrive folder), then in the app: **Menu → Load PC receipt**. Each receipt covers every photo combined so far, from all inspectors, so only the newest one matters. The app checks each photo against the receipt: it counts as confirmed only if the PC has it in the same unit and component folder, with the same file size. Photos that aren't in the receipt (not exported yet, exported Unsorted only, or moved to another unit since) are never removed.

Confirmed photos are removed from the phone automatically once they're older than **Settings → Keep confirmed photos on the phone for** (3 days by default; it can be set to today only, 7 or 14 days, or never). If storage is over 80% full, confirmed photos older than today are removed sooner. Thumbnails, results, notes and links stay, so the spreadsheet is unchanged. The check runs whenever the app opens and whenever a receipt is loaded.

If photos two or more days old still haven't been confirmed by a receipt, the app reminds you (once a day) to export them and get them combined.

## The Menu

From 1.11.1, in this order: **Projects**; **Defective conditions missing photos** (red when any condition marked 1 has no photo); the **Built-in camera** switch; **Add photos & videos from library**; **Edit lists**; **Get the Excel template**; **Load PC receipt**; **Export spreadsheet & photos**; **Settings & storage**.

While the Menu or any other panel is open (unit and component lists, Unlinked, the link page, Settings and so on), the screen behind it doesn't scroll.

## Test mode (from 1.14.0)

For trying out the whole process (exporting, combining on the PC, loading the receipt) with lots of made-up data, on one iPhone. **Settings → Open test mode…**

- **Test phones A–F:** each is a separate "inspector" (A is inspector TA, B is TB, and so on) with its own storage, completely apart from your real projects and photos, which aren't touched. Switching reloads the app. An orange **TEST PHONE** band shows at the top while one is open; **Test mode → Back to the real phone** returns to your real data.
- **Fill with test data:** builds the test project `999999.00-TEST` (Test Condominiums) and records it as that test phone's inspector:
  - **Units:** 25, 100, 300 or 600, with roofs by unit or by building. Use the same settings on every test phone, so they combine as one project.
  - **Photos:** 50 to 2,000. **Small** files are quick (about 0.35 MB each); **Real size** files are about 5 MB each, like real photos, but take a few minutes per 100.
  - **Taken:** today, yesterday, 2 or 3 days ago (photo names, dates and times), to test several site days.
  - **Results already recorded:** **Keep**, or **Change some** (about 1 in 10) to test the Change Log and later combines.
  - What it records: results for about 85% of units; typed answers; windows and doors (the same number on every test phone, so they match when combined); notes; and photos made up on the spot, showing what they're of. Photos go through the normal steps: numbered and renamed, location and details written in, linked (some unlinked, some general, a few linked to two conditions).
  - Each test phone covers two of every four components, so every component is covered by two phones, and they disagree about 1 time in 25, so combining has real conflicts.
- **Then do everything for real:** Export, save the ZIPs to Files, move them to the PC, run the Combine page, and load the receipt on each test phone (**Menu → Load PC receipt**). Fill again (for example as "Yesterday", or with changed results), export the new photos and combine again, to test later batches.
- **Delete test phone X** removes that test phone's data and goes back to the real phone.

## Screen zoom

**Settings → Lock screen zoom** is on by default. Pinch and double-tap don't zoom the screen in or out, so the screen can't be zoomed by accident. Turn it off if you need to zoom the screen; it takes effect straight away and is remembered after you tap **Save**. The built-in camera's own pinch-to-zoom works either way. So does the photo viewer: pinch or double-tap a photo to zoom into it, and drag to look around.

## Opening it from the Home Screen

Always open the app from its Home Screen icon. If it's opened in a Safari tab instead, a yellow banner says so: Safari keeps a separate copy of the app's data, so projects and photos from the Home Screen app don't appear there.

## Photo details: location, time and device (from 1.13.0)

Every photo has its details written into the JPEG file itself (EXIF), so they stay with the photo wherever it's copied. On a Windows PC: right-click the photo → **Properties → Details**.

- **Where:** GPS latitude, longitude, altitude (when the iPhone gives it) and the accuracy of the reading, in metres. iOS removes the location from photos handed to web apps, so the app takes its own reading from Location Services at the moment of each photo. The first time, the iPhone asks to use your location: choose **Allow While Using App**, and keep **Precise Location** on.
- **When:** the date and time taken, with the time zone and fractions of a second. For the built-in camera it's the moment the shutter was pressed.
- **Device:** Make "Apple" and the model. iOS doesn't tell web apps which iPhone they're on, so built-in camera photos say "iPhone" unless **Settings → This iPhone's model** is filled in (e.g. `iPhone 17 Pro`). The built-in camera also records the camera used and the zoom. Photos from the iPhone camera or **＋ Library** keep everything iOS recorded (model, lens, exposure, ISO and so on).
- **What it shows:** project number and name, unit or building, component (and window or door), and inspector, as the photo's description, with the inspector's initials as its author.
- Nothing already in a photo is overwritten, apart from the description and the "software" field. A photo that has to be re-saved (**Settings → Photo size** set to Medium or Large) keeps its original details.
- **＋ Library** photos taken in the last 10 minutes get the current location (you're still on site). Older ones only have a location if it was included when they were picked: in the photo picker, tap **Options** at the top and turn on **Location**.
- **Status:** the built-in camera shows **GPS ±8 m** under the unit name (green), **Finding location…**, or **Location off** (red). Indoors the iPhone may not get a reading; photos are never held up waiting for one (at most a second or so, once a minute). **Settings → Photo location** says whether it's on and how to turn it on.
- **Videos** can't carry these details; their location is in the Photo Log.
- **Photo Log:** new columns **Latitude**, **Longitude**, **Location accuracy (m)**, **Device** and **Added to app** (only for **＋ Library** photos taken earlier). **Taken** is when the photo was taken, which for an older library photo is earlier than when it was added. Photos taken before 1.13.0 have none of these.

Location readings only run while photos are being taken (and for 2 minutes after), to save battery.

## Photo names

`<Project#> <YYYY-MM-DD> <Initials> <####>.jpg`, for example `267180.00 2026-10-02 JJM 0042.jpg` or `267180.00-RENO 2026-10-02 JJM 0042.jpg`.

Photos taken before version 1.7.2 keep their old names (`<Project#>_<Initials>_<YYYYMMDD>_<####>.jpg`), so spreadsheets and folders already exported still match.

The number restarts at 0001 each day for each inspector. The date is included so names never repeat across days. Every number stays accounted for: a photo can only be deleted while its batch is still open (from 1.11.0), and the later photos in the batch then move down one number, so there are never gaps. After that, photos can't be deleted (from 1.10.3); a photo taken by mistake can be left unlinked. Photo numbers are never reused, even if the project is deleted and imported again under the same project number.

## The spreadsheet

- **Unit Matrix:** units down the side and conditions across the top, the same layout as the paper form. Each 1/0 cell links to its proof photo. Totals and % defective are in the bottom rows and right-hand columns.
- **Window / door matrices** (from 1.10.0): each component with one form per item has its own sheet, e.g. **Window Matrix**, with a row per item at every unit. On the Unit Matrix, those components' columns show how many of the unit's items are 1, and the % row is the % of units with at least one. The Summary counts per item, with a "Units with a defective item" column. Item photos are in `Photos/<Unit>/<Component>/<Window 3>/`.
- **Typed answers** appear as typed in the matrices and Observations (numbers as decimals). The Summary lists them under "Answers recorded" (for numbers: how many, lowest and highest; for choices: a count of each), with no 1/0 counts. When combining, different answers from two inspectors are a conflict; type the right answer in Resolved result.
- **Building Matrix** (roofs by building only): the same layout for buildings and the roof conditions. In the Summary, "Not yet recorded" for roof conditions counts buildings; for everything else it counts units. The combined spreadsheet has the same sheet, and its Conflicts sheet links to whichever matrix holds the cell.
- **Summary:** for each condition, Defective (1), Observed (1+0), % defective, NA, NR and not-yet-recorded. These are live formulas. They count by each condition's ID (in the hidden Condition ID column), so names with symbols such as `>` or `*`, or two conditions with the same name, are counted correctly.
- **Observations:** one row per unit and condition, with notes and a link to every proof photo. It is filterable.
- **Photo Log:** every photo, with its unit, component and the conditions it proves.
- **Change Log:** what changed between this inspector's spreadsheet exports (see below).

## Updating the defect list mid-project

Edit the Excel file and import it again with the same project number. The app matches each condition to the new file by its code within the same component first, then by its name. A matched condition keeps its results, notes and photos even if its name was corrected.

Units, components and conditions that are no longer in the file are kept if they have results, notes or photos. They are tagged **No longer in the import file**, and you can delete them in **Menu → Edit lists**. Ones with no data are dropped.

## Storage

- Photos are kept inside the app's private storage on the iPhone. They are not in the Photos app or iCloud Drive, and nothing is deleted automatically when a project ends.
- iOS decides how much space the app may use. It's a share of the phone's free space, so freeing space on the phone raises the limit. **Settings & storage** shows how much is used.
- Space is cleared automatically once the PC has confirmed it has the photos (see above).
- A removed photo keeps its thumbnail and its links. Unlinking one asks you to confirm first, so the wrong photo isn't unlinked by mistake. Removed photos can't be moved to another unit, because their exported copy is already in that unit's folder.
- **Settings & storage → Free up space** still works as before: it removes every exported full-size photo, whether or not the PC has confirmed it. Thumbnails, results and links stay.
- When a project is finished and everything is exported and saved, delete it from **Menu → Projects**.

## Good habits

- Export **"Spreadsheet + new photos"** at the end of each site day. This is your backup. The app's data lives only on the phone, and deleting the app deletes it.
- Export new photos as often as you like during the day; combine them on the PC and load the receipt to free space. Planning figure: about 7 MB per photo on an iPhone 17 Pro (21 MB in the ZIP with both Sorted and Unsorted copies).
- If storage gets tight, choose **Settings → Photo size → Medium**.

## Versions and rolling back

Every version is saved, complete, in its own folder inside `site-forms_claude` on the Desktop (`v1.0.1`, `v1.1.0`, `v1.2.0`, `v1.3.2`, `v1.4.0`, `v1.4.1`, `v1.4.2`, `v1.4.3`, `v1.4.4`, `v1.4.5`, `v1.4.6`, `v1.5.0`, `v1.5.1`, `v1.6.0`, `v1.7.0`, `v1.7.1`, `v1.7.2`, `v1.7.3`, `v1.7.4`, `v1.7.5`, `v1.8.0`, `v1.9.0`, `v1.9.1`, `v1.9.2`, `v1.10.0`, `v1.10.1`, `v1.10.2`, `v1.10.3`, `v1.10.4`, `v1.10.5`, `v1.10.6`, `v1.10.7`, `v1.10.8`, `v1.10.9`, `v1.10.10`, `v1.10.11`, `v1.10.12`, `v1.10.13`, `v1.10.14`, `v1.11.0`, `v1.11.1`, `v1.12.0`, `v1.12.1`, `v1.13.0`, `v1.13.1`, `v1.14.0`, …). Each folder holds all the app files (10 up to 1.7.5; from 1.8.0, 11 app files (the icon files are named after the icon design from 1.10.12; from 1.10.14 there are 10: `icon-sgh-gradient-180/192/512.png`, `icon-sgh-charcoal/pattern/mint-180.png` and `icon-clip-gradient/charcoal/pattern/mint-180.png`) plus the 3 Combine page files `combine.html`, `combine.js` and `xlsx-style.min.js`), the PC combine tool, and `VERSION.txt` describing what changed.

To go back to a version, upload **all the files** from that version's folder to GitHub (they replace the current ones), then open the app twice on each phone. Projects, results and photos on the phone are not affected. Versions before 1.3.2 don't have automatic updates, so after rolling back that far, phones may need an extra open or two to pick up later updates.

## Updating the app

When the app code changes, upload **all** the changed files together, at the top level of the repository (not inside a folder). Each version has a matching number in four places: `APP_VERSION` in `app.js`, `VERSION` in `sw.js`, and `app-version` in `index.html` and `combine.html`.

From version 1.3.2 on, a phone with a connection picks up a new version automatically. From 1.7.0, the app only reloads by itself in the first few seconds after opening. If an update arrives later, while you're working, a blue **Update ready — tap to restart** bar appears instead, so a camera, a note or an export is never interrupted. If the files on GitHub don't match each other (for example, one was missed in an upload), **Menu** shows a warning next to the version number. Phones pick up the update the next time the app is opened with a connection.
