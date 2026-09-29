// ShopControl staff user manual: the single source for both the in-app page
// (client/manual/index.html) and the Word copy (client/manual/ShopControl-User-Manual.docx).
// After changing anything here run:  node docs/manual/build.js
//
// Update this manual (and bump VERSION + add a CHANGES entry) whenever a change
// alters how staff use the program.
//
// Block types: { p }, { h3 }, { steps: [] }, { bullets: [] }, { tip }, { note },
// { table: { head: [], rows: [[]] } }.  Inline **bold** is supported in any text.

const VERSION = "1.9";
const UPDATED = "September 28, 2026";

const CHANGES = [
  { version: "1.9", date: "September 28, 2026", text: "New **Find a vehicle** search at the top of the office program. It finds any car, at any stage or finished, by RO, customer, vehicle, VIN, plate or claim number." },
  { version: "1.8", date: "September 28, 2026", text: "New **Completed Jobs** tab with each finished job's full file (production timeline, parts, QC, photos, every change). Only an admin can delete a delivered job or its parts." },
  { version: "1.7", date: "September 28, 2026", text: "The Employee App now shows **where each part is**: the car's parts cart, and the cart shelf or storage spot for every part." },
  { version: "1.6", date: "September 28, 2026", text: "Whoever does **Check-In** automatically gets the **Final QC** checklist too. New **QC report** for each car: all five checklists with signatures on one printable page." },
  { version: "1.5", date: "September 28, 2026", text: "Body technicians automatically get the **Reassy** checklist too." },
  { version: "1.4", date: "September 28, 2026", text: "Employees can be set to **also do** other checklists (for example a body tech who reassembles also gets the Reassy checklist)." },
  { version: "1.3", date: "September 28, 2026", text: "New accounts and admin password resets use a temporary password; you choose your own the first time you sign in." },
  { version: "1.2", date: "September 28, 2026", text: "Added the **Help** tab in the office program and a search box in the manual." },
  { version: "1.1", date: "September 28, 2026", text: "Employee App address is now **https://conceptautobody.app** and works on phones anywhere. Added how to put it on your phone's home screen." },
  { version: "1.0", date: "September 28, 2026", text: "First edition." },
];

const sections = [
  {
    id: "start",
    title: "Getting started",
    blocks: [
      { p: "ShopControl is Concept Autobody's shop management system. The office uses the full program on the shop computers; technicians use the **Employee App**, a phone-friendly version built for checklists, photos, time off and messages. Both use the same login." },
      { h3: "Opening ShopControl" },
      { bullets: [
        "**Employee App (phones):** go to **https://conceptautobody.app** in Safari or Chrome. It works anywhere you have internet, in the shop or not.",
        "**Office computers (full program):** open **https://shopcontrol.conceptauto.local** in Chrome or Edge. This address only works on the shop network. The Employee App is also under **Employee app** in the left menu.",
      ] },
      { h3: "Finding help" },
      { bullets: [
        "**Office computers:** click **Help** in the left menu to read this manual inside ShopControl. Use **Download Word copy** to print it.",
        "**Employee App:** Staff Hub → **User manual**.",
        "Type a word or two about what you need in the **search box** at the top of the manual to see just the sections that cover it.",
      ] },
      { h3: "Put the app on your phone's home screen" },
      { p: "Do this once and the app opens like any other app, with the Concept Autobody icon." },
      { steps: [
        "**iPhone:** open **https://conceptautobody.app** in **Safari**, tap the **Share** button (square with an arrow), then **Add to Home Screen**, then **Add**.",
        "**Android:** open **https://conceptautobody.app** in **Chrome**, tap the **⋮** menu, then **Add to Home screen** (or **Install app**), then **Add**.",
      ] },
      { h3: "Logging in" },
      { steps: [
        "Enter the **username** and **password** the office gave you.",
        "Tap **Sign in** (Employee App) or click **Log In** (office computers).",
        "**First time signing in:** the password the office gave you is temporary. ShopControl asks you to **choose your own password** (at least 8 characters, typed twice) before you can do anything else. Pick something only you know.",
        "If you forget your password, click **Forgot password?** on the office login and enter your username. If your account has an email address, a reset link is emailed to you. It works from your phone and expires in 30 minutes. Otherwise ask an admin to reset it.",
      ] },
      { note: "After **10 wrong passwords in a row**, that username is locked for **15 minutes**. Wait, then try again, or ask an admin to reset your password." },
      { h3: "Staying up to date" },
      { p: "ShopControl refreshes itself every 20 seconds, so you'll see other people's changes without doing anything. When the program itself is updated, refresh the page once to load the new version. If something looks old or broken after an update, press **Ctrl+F5** on a computer." },
      { h3: "Who can do what" },
      { p: "What you can see and change depends on your **role**, set by an admin in Employees:" },
      { table: { head: ["Role", "What it's for"], rows: [
        ["Admin / Owner", "Everything, including Employees, Board Settings, approving time off and deleting records."],
        ["Manager", "Everything except Employees and Board Settings; cannot approve time off."],
        ["Office", "Jobs, tasks, parts, missed calls, AR, photos; can view QC and booth logs."],
        ["Estimator", "Jobs, tasks, QC, photos."],
        ["Parts", "Jobs, tasks, parts and carts."],
        ["Body / Paint / QC", "Jobs, tasks, QC checklists, photos; can view (not change) parts. Paint also has the booth log."],
        ["Cleanup Helper", "Tasks, facility checklist, booth log."],
        ["Display / TV", "View only. Used for the TV in the shop."],
      ] } },
      { p: "Separately, each employee can have a **QC Department** (Check-In, Body, Paint, Reassy or Final QC). That decides which checklist opens for them in the Employee App, and it lets anyone with a department fill out QC checklists." },
    ],
  },

  {
    id: "app",
    title: "The Employee App (technicians)",
    blocks: [
      { p: "The Employee App is what technicians use day to day. Everything saves to the same ShopControl the office sees." },
      { h3: "Home screen" },
      { bullets: [
        "**In the shop:** every vehicle marked onsite, with its picture, RO number, customer and stage. The ring on the right shows how much of **your department's** checklist is done for that car.",
        "**Search:** type an RO number, customer name or vehicle to find any open job, even one that isn't onsite.",
        "**Staff Hub** button: time off, mailbox, company info and this manual.",
        "**Envelope icon:** your mailbox. A red number means unread messages.",
        "**Bell icon:** parts and core-return alerts.",
        "**Exit icon** (top right): sign out.",
      ] },
      { h3: "Doing your QC checklist" },
      { steps: [
        "Tap a vehicle on the home screen.",
        "Tap the big colored button with your department's name (for example **Body QC**).",
        "Tap each item as you complete it. It turns colored with a check mark. Tap again to undo.",
        "Some items have a box to fill in (for example the A/C center vent temperature on Check-In).",
        "Add **Notes** for the next department if needed.",
        "Tap **Sign & finish** when you're done.",
      ] },
      { tip: "Every tap saves automatically (you'll see **Saved** at the top). If your phone locks or you walk away, nothing is lost. Come back to the car and pick up where you left off." },
      { p: "**Body technicians** reassemble the cars they work on, so every body tech automatically gets two big buttons on every car: **Body QC** and **Reassy QC**. The same goes for **Check-In**: whoever checks cars in often does the final QC too, so they get **Check-In QC** and **Final QC**. If you cover another department too, the office can add that checklist to your account and it shows as another button." },
      { h3: "Signing and rework" },
      { steps: [
        "The finish screen shows any items still unchecked.",
        "Choose **No, all good** or **Yes, needs rework**. For rework, write what needs fixing, who it's assigned to, and a due date.",
        "Sign in the white box with your finger (tap **Clear signature** to redo).",
        "Tap **Submit QC**. A completed checklist gets a celebration screen.",
      ] },
      { p: "Open rework shows on the vehicle screen for everyone. When the fix is done, tap **Mark rework done**." },
      { h3: "Other departments' checklists" },
      { p: "On the vehicle screen, **Other departments** shows each department's progress on that car. Tap one to view it, or to fill it out if you're helping cover that department." },
      { h3: "Photos and parts" },
      { bullets: [
        "**Photos:** tap **Take a photo** to use the camera, or **Choose a file** for pictures and PDFs. Add a caption first if you like. Photos attach to the job and the office sees them in ShopControl.",
        "**Parts:** every part on the RO with its status and **where it is**. The car's parts cart shows at the top (and on the Parts button, for example **Cart #13 · 4/5 here**). Each part shows its spot with a 📍, like **Cart #13 · Shelf 2**, **#3 A · Black Shelves Wall** or **Receiving Bumpers · Bumper Racks**. A part that has arrived but hasn't been put away yet says **Here, not put away yet · ask parts**. Parts that need attention (late, backordered, wrong part, return needed) are marked in red.",
      ] },
    ],
  },

  {
    id: "hub",
    title: "Staff Hub: time off, mailbox and company info",
    blocks: [
      { p: "Open it from the **Staff Hub** button on the Employee App home screen." },
      { h3: "Requesting time off" },
      { steps: [
        "Tap **Request time off**. Your name fills in automatically.",
        "Choose the type: **Sick, Vacation, Bereavement, Time off without pay, Military, Jury duty, Maternity/Paternity** or **Other**. For Other, write in the reason.",
        "Pick the **first day** and **last day**.",
        "For part of one day (for example leaving at 2 PM), check **Partial day** and enter the from and to times.",
        "Add notes if the office should know anything, then tap **Submit request**.",
      ] },
      { p: "The office and admins are emailed right away. **Only an admin can approve or deny** a request. You'll get a message in your mailbox (and an email if your account has one) when it's decided." },
      { h3: "Checking your requests" },
      { p: "**My requests** shows each request as **Waiting for approval**, **Approved** or **Denied**, with the admin's note. You can cancel a request while it's still waiting." },
      { h3: "Mailbox" },
      { bullets: [
        "Messages from the office show here. Unread ones have an orange dot and are counted on the envelope icon.",
        "Tap a message to read it, then **Reply** to answer the sender.",
        "Tap the pencil icon to write a new message. Technicians can message **the office**; office staff and admins can message a person, a department, the office, or everyone.",
      ] },
      { h3: "Company info and this manual" },
      { p: "**Company info** holds shop information the office posts (hours, contacts, policies). **User manual** opens this guide." },
    ],
  },

  {
    id: "search",
    title: "Finding a vehicle",
    blocks: [
      { p: "The **Find a vehicle** box at the top of every office screen finds any car ShopControl has ever had: opportunities, cars in production, and delivered or total-loss jobs. Click it (or press **/** or **Ctrl+K** from anywhere) and start typing." },
      { bullets: [
        "Search by **RO or estimate number, customer name, year / make / model, color, VIN (even just the last 6), license plate, claim number, insurance company or estimator**.",
        "Type more than one word to narrow it down, for example **camry silver** or **toyota lopez**.",
        "Cars still in the shop are listed first, each with its stage (for example **Paint · on site**). Opportunities are marked **Opportunity**. Finished cars show **Delivered** with the date.",
        "Click a result, or use the arrow keys and press **Enter**. A car in the shop opens its job window (with **Open full Shop Control job** and **QC report**). A finished car opens its file in **Completed Jobs**.",
        "Press **Esc** to clear the search.",
      ] },
      { note: "Jobs someone deleted don't show here. Find them under **Completed Jobs → Show deleted jobs**." },
    ],
  },

  {
    id: "dashboard",
    title: "Dashboard",
    blocks: [
      { p: "The first screen in ShopControl. Every number is a shortcut: **click a tile to jump to that list**." },
      { bullets: [
        "**Booth Filter Countdown** at the top: days left before the paint booth filters are due (30-day cycle). Green is fine, yellow is due soon, red is overdue or not recorded. Use **Reset Filter Countdown** after changing filters.",
        "**Arrivals and jobs:** scheduled arrivals, cars on the road, open opportunities, active jobs, must-move and delivery-today counts.",
        "**Needs attention:** estimates and supplements needed, management help, customer updates needed, cars sitting too long, overdue tasks, QC failures.",
        "**Parts:** Parts Problems (counted by vehicle), Parts Not Arrived On Time, Parts No RO Yet, parts needing return or mirror match, parts value on site and parts 25+ days on site.",
        "**Time-Off Requests Pending** (office and admins only).",
      ] },
    ],
  },

  {
    id: "jobs",
    title: "Jobs and the Daily GO List",
    blocks: [
      { p: "Every vehicle is a **job**. The Daily GO List is the full list; the boards are visual views of the same jobs. Change a job anywhere and it changes everywhere." },
      { h3: "RO numbers" },
      { bullets: [
        "A real RO number is **all digits** (normally 5, like 17944). A job with a 5-digit RO is an **active job**.",
        "Estimates that don't have an RO yet show CCC's file number instead (letters and numbers, like 0a7fce43). Those are **opportunities**: they can't be marked onsite or scheduled until they get a 5-digit RO.",
        "**An RO number can only be on one job.** If you type an RO that's already on another job, ShopControl stops you and tells you which job has it. Check the RO in CCC.",
      ] },
      { h3: "Adding or editing a job" },
      { steps: [
        "Go to **Daily GO List** and open **Add or edit job**, or click a job's **Edit** button.",
        "Fill in RO, customer, vehicle, stage, priority, who's responsible and today's goal.",
        "Check **Vehicle is physically onsite** when the car is in the shop.",
        "Click **Save**.",
      ] },
      { p: "Use the view list next to the search box to filter: active onsite jobs, must move today, estimates needed, customer updates needed, and more." },
      { h3: "Customer updates" },
      { p: "Every customer gets updated on a schedule, and ShopControl reminds you:" },
      { bullets: [
        "**First call within 24 hours** of the car being marked onsite, so they know we're on it.",
        "Then every **2 days** for jobs under $4,000, and every **3 days** for jobs $4,000 and up or flagged **Structural repair**.",
      ] },
      { steps: [
        "Call or text the customer.",
        "Set **Customer Updated** to **Yes** on the job and save.",
        "When the next update is due, ShopControl switches it back to **No** by itself and the car shows under **Customer Updates Needed** on the dashboard.",
      ] },
      { p: "The job form shows when the customer was last updated and when the next update is due." },
    ],
  },

  {
    id: "boards",
    title: "Production, Delivery and Planning boards",
    blocks: [
      { h3: "Production Board" },
      { p: "Every onsite car as a card in a column for its stage (Check-In, Tear Down, Body, Paint, Assembly, Detail, QC, Ready for Delivery and more). Each card shows the vehicle picture, RO, customer, value, hours, technicians, dates and flags." },
      { bullets: [
        "**Move a car:** drag its card to another column, or click the card and change the stage.",
        "**Edit a car:** click its card. The window has everything: insurance, estimator, hours, dates, technicians, flags and card color.",
        "**Card colors** (pay type, must go, problem job, etc.) are set in **Board Settings**.",
        "**Filters:** search, location, insurance, technician and sort. **More filters** adds estimator, due date, payment and flags. **Icons only** shrinks flag labels to icons when the board is crowded.",
      ] },
      { h3: "Vehicle pictures" },
      { p: "Each card shows a picture of the vehicle type in its color, guessed automatically from the CCC vehicle description. To change it, click the card and use **Vehicle picture**: pick the **Type** and a **color** swatch. The preview updates as you choose. **A** (Auto) goes back to the automatic guess." },
      { h3: "Delivery and Planning boards" },
      { bullets: [
        "**Delivery Board:** cars from Ready for Delivery through pre-close, confirming payment, delivery scheduled and delivered/paid.",
        "**Planning Board:** upcoming work by week (Unscheduled, This Week, Next Week, 2 and 3 Weeks Out, Future / Holding).",
        "**Opportunities:** estimates without an RO. Follow up, assign an RO, then schedule arrival.",
        "**Calendar:** appointments (drop-offs, pickups, etc.) linked to jobs, by day, week, month or list.",
      ] },
      { h3: "TV display" },
      { p: "The shop TV shows the Production Board full screen and scrolls through the columns by itself. It reloads every 3 hours to pick up updates. To open it on a computer, click **TV display** in the left menu." },
    ],
  },

  {
    id: "ccc",
    title: "CCC estimates coming into ShopControl",
    blocks: [
      { p: "When an estimate or supplement is saved in CCC, ShopControl picks it up automatically within about a minute:" },
      { bullets: [
        "A new estimate creates a job (an opportunity until it has an RO), with parts from the estimate lines.",
        "A supplement updates the same job: amount, customer, vehicle and any new parts. It never creates a duplicate.",
        "When CCC assigns the real RO number, the job and its parts move over to that RO.",
        "Commercial / fleet jobs use the company name (for example Ceres Unified) as the customer.",
        "**Closed ROs are ignored.** If CCC re-sends an RO after the car left (a payment or insurance edit), ShopControl does not bring the job back or re-add its parts.",
      ] },
      { p: "If an estimate doesn't show up, re-save it in CCC. The **CCC Import** tab also lets you upload CCC files by hand." },
    ],
  },

  {
    id: "parts",
    title: "Parts",
    blocks: [
      { p: "The **Parts** tab lists parts grouped by vehicle. Use the view list to switch between all open parts, need to order, ordered, backordered, received, need mirror match, returns, **Parts Problems**, **Not Arrived On Time** and **No RO Yet**." },
      { h3: "What counts as a problem" },
      { p: "Each part is judged on its own, so one late part out of twenty counts as one problem. A part is a problem if it's past its ETA and not received, backordered, wrong, needs a return or credit, received but not mirror matched, or still Need to Order on a car with an RO. The **Problems** column shows how many parts on each car need attention, and opening a car from Parts Problems shows just those parts with the reason next to each." },
      { bullets: [
        "**No RO Yet:** parts for estimates that don't have an RO. They're kept out of Parts Problems until the car is confirmed.",
        "**Not Arrived On Time:** ordered parts whose ETA date has passed without being received.",
      ] },
      { h3: "Ordering parts" },
      { steps: [
        "Click **Open Parts** on a vehicle.",
        "Select the parts (or **Select all parts**).",
        "Click **Order Selected** and enter the **expected arrival (ETA)** the vendor gave you.",
      ] },
      { p: "If a part isn't marked received by its ETA, it moves to **Parts Not Arrived On Time**." },
      { h3: "Mirror matching and carts" },
      { steps: [
        "When parts arrive and are mirror matched, select them and click **Mirror Match Selected**.",
        "Choose the **cart** they go on. Carts already holding that RO are listed first, then empty carts. Pick a shelf now or sort it later.",
        "In **Carts & Shelves**, click the cart and drag each part onto its shelf. Parts without a shelf wait in the **Needs a shelf** column.",
      ] },
      { note: "One vehicle per cart. A cart belongs to the first RO placed on it until it's cleared." },
      { p: "Technicians see these spots in the Employee App under **Parts**, so always record where a part was put (cart and shelf, or storage spot). A part that is received but not placed shows as **not put away yet**." },
      { h3: "Other parts screens" },
      { bullets: [
        "**Shop Floor Plan:** carts and storage locations by zone.",
        "**Returns & Alerts:** parts waiting to be returned, credits outstanding and parts on site 25+ days (check vendor return terms).",
        "**Manage Locations:** add carts and storage locations, set shelves and zones.",
        "**Cores:** mark a part as having a core; the parts team gets an alert until the core is marked returned.",
      ] },
    ],
  },

  {
    id: "qc",
    title: "Vehicle QC (office view)",
    blocks: [
      { p: "Technicians fill out QC checklists in the Employee App. The **Vehicle QC** tab shows every checklist with its department and progress (for example 8/10 checked). Click **Checklist** to see each item, the notes and the signature." },
      { h3: "Pulling up a car's QC report" },
      { p: "Every checklist is saved in ShopControl under the car's RO number, so nothing is lost when the car is delivered. To see everything for one car on a single page, click **Car report** on any of its rows in the **Vehicle QC** tab, or open the car on the **Production Board** and click **QC report**." },
      { p: "The report opens in a new tab and shows all five checklists in shop order: every item, values like the A/C vent temperature, notes, rework, who did it and when, and their signature. Departments nobody has started say **Not started**. Click **Print / Save as PDF** to print it or keep a PDF copy for the file." },
      { p: "The five checklists are **Check-In, Body, Paint, Reassy** and **Final QC**, taken from the shop's QC sheet. No vehicle should be delivered until Final QC is complete and signed." },
    ],
  },

  {
    id: "completed",
    title: "Completed Jobs (job records)",
    blocks: [
      { p: "When a car is delivered (or marked Total Loss) it leaves the boards, but nothing about it is lost. The **Completed Jobs** tab (left menu, under Delivery Board) lists every finished job with when it came in, when it was delivered, days in the shop, repair value, how many parts it had and how many QC checklists were done. Search by RO, customer, vehicle or insurance, or filter by delivered date." },
      { p: "Click a job to open its **job file**:" },
      { bullets: [
        "**Job details:** customer, vehicle, value, insurance, estimator, the techs and painters on it, in / on-site / delivered dates, days in shop and hours.",
        "**Production timeline:** every stage move with the date, time and who moved it, and how long the car sat in each stage.",
        "**Parts:** every part with vendor, estimated cost, status, ordered / ETA / received dates and where it was stored. Parts removed from the job along the way are listed separately with who removed them and when.",
        "**Quality control:** all five checklists with who did them and when they were signed. Click **Open full QC report with signatures** for the complete checklists.",
        "**Photos and files, appointments, core returns and notes.**",
        "**Every change:** each edit to the job (supplement amounts, estimator, techs, dates and so on), who made it and when, including updates from CCC.",
      ] },
      { p: "Click **Print / Save as PDF** to print the job file or keep a PDF copy, for example for an insurance question or a comeback." },
      { h3: "Deleted jobs" },
      { p: "Tick **Show deleted jobs** to see jobs someone deleted. ShopControl keeps a copy of every deleted job, so its file can still be opened (it shows who deleted it and when)." },
      { note: "Delivered and total-loss jobs are the shop's record of the repair. Only an **admin or owner** can delete them or the parts on them; anyone else gets a message instead." },
    ],
  },

  {
    id: "office",
    title: "Office tools",
    blocks: [
      { h3: "Missed Calls / Callback Requests" },
      { p: "Log every missed call with the caller, number, reason and who owns the callback. Log each callback attempt. A call still **New** or **In progress** after **1 business hour** shows as overdue on the dashboard (**Missed Calls Overdue**). Mark it **Returned / resolved** when done, or **Closed — no callback needed** with a reason." },
      { h3: "Tasks" },
      { p: "Assign tasks with a due date. The person is emailed when the task is assigned and reminded by email if it's still open after 1 hour and again after 3 hours. Anything that can't be done today should be flagged to management before the end of the day." },
      { h3: "Booth Filters and Facility Checklist" },
      { p: "Log each paint booth filter change (with a picture) to reset the 30-day countdown. The weekly **Facility Checklist** covers the booth, compressor and shop equipment; mark anything **Needs Attention** and create a task if needed." },
      { h3: "AR Balances and Cycle Time" },
      { bullets: [
        "**AR Balances:** open balances by RO, who owes it and when it's due.",
        "**Cycle time tabs:** active jobs by dollar range with target days in the shop: under $2,000 = 2 days, $2,000–4,000 = 4 days, $4,000–10,000 = 8 days, $10,000+ = 15 days.",
      ] },
      { h3: "Photos and Activity Log" },
      { bullets: [
        "**Photos:** upload photos and PDFs tied to a job or record.",
        "**Activity Log:** who added, changed, deleted or uploaded what, and when.",
      ] },
    ],
  },

  {
    id: "staffdesk",
    title: "Time off and messages (office and admins)",
    blocks: [
      { h3: "Time Off tab" },
      { p: "Shows every request with who's out today. New requests also email the office and admins and appear under **Notifications**." },
      { steps: [
        "Open **Time Off** (the tab shows a red number when requests are waiting).",
        "Admins: click **Approve** or **Deny**, add an optional note, and confirm.",
        "The employee gets a mailbox message and an email with the decision.",
      ] },
      { note: "Only **admins and owners** can approve or deny. Managers and office staff can see requests but not decide them." },
      { h3: "Messages & Info tab" },
      { bullets: [
        "**Inbox:** your messages. Click one to read it and **Reply**.",
        "**New message:** send to one person, a department (for example all of Paint), the office, or everyone. It appears in their Employee App mailbox.",
        "**Company info** (admins): **Add section** for things like shop hours, holiday schedule or who to call. Staff see it under Staff Hub → Company info.",
      ] },
    ],
  },

  {
    id: "admin",
    title: "Admin: employees and settings",
    blocks: [
      { h3: "Adding an employee" },
      { steps: [
        "Open **Employees** (admins only) and **Add or edit employee**.",
        "Enter full name, username, email (needed for password resets and emails), job title and a **temporary password** (8+ characters). They must choose their own the first time they sign in.",
        "Choose the **Role** (what they can access) and **QC Department** (which checklist opens in their Employee App).",
        "Click **Add Employee** and give them their username and temporary password.",
      ] },
      { h3: "Changing an employee" },
      { bullets: [
        "**Edit:** change name, email, job title, role and QC department. Setting someone's QC department to **Body** automatically gives them the **Reassy** checklist too, and **Check-In** automatically gives them **Final QC**. Use **Also does these checklists** for anyone else who covers more than one department (for example a painter who also does Final QC). The list shows everything extra under their QC department.",
        "**QC Department** dropdown in the list: change it directly.",
        "**Reset Password** sets a new temporary password; the employee must choose their own at next sign-in. Anyone still on a temporary password shows **Needs new password** in the list.",
        "**Grant/Revoke Delete**, **Deactivate / Reactivate**. Deactivate people who leave instead of deleting them.",
      ] },
      { h3: "Board Settings" },
      { p: "Admins set the shared lists used everywhere: insurance companies, technicians, estimators, pay types, locations, appointment types, flags, card colors, and who receives core-return and missed-call escalation alerts." },
    ],
  },

  {
    id: "help",
    title: "Quick answers",
    blocks: [
      { table: { head: ["Problem", "What to do"], rows: [
        ["The page looks old or something's missing after an update", "Press Ctrl+F5 on a computer, or close and reopen the app on a phone."],
        ["The app won't open on my phone", "Check the address is https://conceptautobody.app and that you have internet (Wi-Fi or cell data). The shopcontrol.conceptauto.local address doesn't work on phones."],
        ["I can't log in", "Check the username. After 10 wrong tries wait 15 minutes. Use Forgot password? or ask an admin."],
        ["An estimate from CCC isn't in ShopControl", "Re-save it in CCC and wait a minute. Closed ROs are ignored on purpose."],
        ["It says the RO is already on another job", "Look up the RO in CCC. Fix the RO on the wrong job first."],
        ["A car isn't on the Production Board", "It needs a 5-digit RO and Vehicle is physically onsite checked."],
        ["A card shows the wrong vehicle picture", "Click the card and change Type and color under Vehicle picture."],
        ["My checklist didn't save", "Look for Saved at the top. If it says Not saved, check your internet connection (Wi-Fi or cell data); it keeps retrying on its own."],
        ["I need a different QC checklist", "Ask an admin to set your QC Department, or tap the department on the vehicle screen."],
      ] } },
      { p: "For anything else, message the office from the Staff Hub mailbox." },
    ],
  },
];

module.exports = { VERSION, UPDATED, CHANGES, sections };
