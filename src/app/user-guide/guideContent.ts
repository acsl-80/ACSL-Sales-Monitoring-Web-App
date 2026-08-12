import type { RouteKey } from "@/lib/permissions";
import loginShot from "@/assets/guide/02-login-page.png.asset.json";
import profileShot from "@/assets/guide/02-change02-profile-page.png.asset.json";
import sidebarFullShot from "@/assets/guide/03-sidebar-full.png.asset.json";
import sidebarCollapsedShot from "@/assets/guide/03-sidebar-collapsed.png.asset.json";
import mobileMenuOpenShot from "@/assets/guide/03-mobile-menu-open.png.asset.json";
import mobileMenuClosedShot from "@/assets/guide/03-mobile-menu-closed.png.asset.json";
import topbarHeaderShot from "@/assets/guide/03-topbar-header.png.asset.json";
import dashboardShot from "@/assets/guide/04-dashboard-full.png.asset.json";
import userManagerTableShot from "@/assets/guide/05-user-manager-table.png.asset.json";
import createUserFormShot from "@/assets/guide/05-create-user-form.png.asset.json";


export const GUIDE_LAST_UPDATED = "2026-08-12";

/** A numbered annotation marker placed on a screenshot (percentages of the image). */
export interface GuideMarker {
  n: number;
  label: string;
  x: number;
  y: number;
  arrow?: boolean;
  arrowDirection?: "left" | "right";
}

/** A highlight box drawn on a screenshot (percentages of the image). */
export interface GuideBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GuideFigure {
  /** Referenced from the body with {{figure:id}} */
  id: string;
  src: string;
  caption: string;
  alt?: string;
  markers?: GuideMarker[];
  boxes?: GuideBox[];
}

export interface GuideSection {
  id: string;
  title: string;
  /** Section is shown when the user can access at least one of these routes. Omit for everyone. */
  routeKeys?: RouteKey[];
  /** Restrict to super admins only. */
  superAdminOnly?: boolean;
  /** Markdown body. Use ### for sub-headings (they become TOC sub-items). */
  body: string;
  /** Annotated screenshots, placed in the body with a {{figure:id}} line. */
  figures?: GuideFigure[];
}


export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "introduction",
    title: "1. Introduction",
    body: `The ACSL Stove Sales & Monitoring Platform is the system used to track clean cookstoves from their allocation to sales partners, through their sale to end users, while monitoring instalment payments and capturing end-user information for tracking, monitoring, and reporting.

Everything in the platform is built around three things:

- **Stoves** — each physical stove has a unique **stove serial (stove ID)**.
- **Sales** — a sale links one stove serial to one end user, one partner, one sales (payment) model and the person who recorded it.
- **Users** — super admins, ACSL agent managers, ACSL agents, partners and partner agents. What you can see and do depends entirely on which of these you are.

### Who uses the platform

| User group | Typical job | What they mainly do |
| --- | --- | --- |
| Super Admin | System owner | Full access to every screen, setting and record |
| ACSL Agent Manager | Supervises ACSL agents | Manages agents and partners in their area, allocates stoves, reviews performance |
| ACSL Agent | Field officer for ACSL | Works with assigned partners, allocates and sells stoves, records sales |
| Partner | Distributing organisation | Manages its own agents, buys stoves from ACSL, sells and collects payments |
| Partner Agent | Sales person for a partner | Sells stoves and records the sale |

### About this guide

This guide is **role aware**. You only see chapters for the parts of the system your account is allowed to open, so what one colleague sees here may differ from what you see. Use the contents list on the left to jump to a chapter, the search box to find a topic, and the Previous / Next buttons at the end of each chapter to read straight through.`,
  },

  {
    id: "getting-started",
    title: "2. Getting started",
    body: `### Signing in

1. Open the application address in your browser.
2. Enter the **username or email address** given to you by your administrator.
3. Enter your **password**.
4. Click **Login**.

{{figure:login}}

If the details are wrong you will see an error message above the form. Check for stray spaces and that Caps Lock is off. If you still cannot get in, ask an administrator to reset your password — there is no self-service reset.

### First-time password change

The first time you sign in with a password that was created for you, the system opens a **Password Change Required** window. You must set your own password before you can continue.

1. Type the new password. The strength indicator underneath shows how strong it is.
2. Re-type it in the confirmation field.
3. Click the confirm button. You are taken straight to your dashboard.

Super admin accounts are not asked to do this.

### Your session

- You stay signed in while the browser tab is open and for a period afterwards.
- If your session expires, the app returns you to the login screen. Sign in again — nothing you already saved is lost.
- Occasionally after a new version is released the page reloads itself once. This is normal and simply loads the newest files.

### Your profile

Open **Profile** from the top-right user menu. The profile window shows your name, username, email and organisation, and holds the password change form.

{{figure:profile}}

### Changing your password

Your password is changed from the same profile window, in the **Security → Change Password** block:

1. Type your **current password**.
2. Type the **new password**, then repeat it in **Confirm new password**. Both must match.
3. Click **Update Password**. The button stays disabled until all three fields are filled.
4. A confirmation message appears when the change is saved. Use the new password the next time you sign in.

Use the eye icon at the end of any password field to reveal what you have typed.

### "You are not authorised to view this page"

If you type or follow a link to a screen your role cannot open, the platform shows the **Unauthorized** page. Use the sidebar to go back to a screen you do have access to. If you believe you should have access, contact a super admin — access is controlled by your user group.`,
    figures: [
      {
        id: "login",
        src: loginShot.url,
        caption: "The login screen.",
        alt: "Login screen with username or email, password and Login button",
        markers: [
          { n: 1, label: "Username or Email — the username or email your administrator gave you.", x: 22, y: 47 },
          { n: 2, label: "Password.", x: 22, y: 68 },
          { n: 3, label: "Login — signs you in and opens your dashboard.", x: 22, y: 83 },
        ],
        boxes: [{ x: 26, y: 40, w: 44, h: 12 }],
      },
      {
        id: "profile",
        src: profileShot.url,
        caption: "The Profile window — your details and the Change Password form.",
        alt: "Profile window showing full name, username, email, organisation and the change password form",
        markers: [
          { n: 1, label: "Your name and email, as recorded on your account.", x: 15, y: 11, arrow: true },
          { n: 2, label: "Your profile details: full name, username, email and organisation.", x: 15, y: 38 },
          { n: 3, label: "Change Password — current password, new password and confirmation.", x: 15, y: 68 },
          { n: 4, label: "Update Password — saves the new password. Disabled until all three fields are filled.", x: 15, y: 89 },
        ],
        boxes: [{ x: 25, y: 60, w: 55, h: 30 }],
      },
    ],
  },



  {
    id: "navigation",
    title: "3. Finding your way around",
    body: `### The sidebar

The **Control Panel** menu on the left is the main navigation. It only lists the areas your role can open, so it is shorter for some users than for others.

{{figure:sidebar-collapsed}}

- A menu item with a small arrow on the right is a **group**. Click it to expand or collapse it and reveal its sub-items.
- The item you are currently on is highlighted in solid green; the active sub-item is shown in green text.
- On phones and small tablets the sidebar is hidden. Tap the menu button in the top bar to slide it out, and tap outside it (or the X) to close it.

{{figure:mobile-menu-open}}

{{figure:mobile-menu-closed}}

With every group expanded you can see the whole structure of the platform in one view:

{{figure:sidebar-full}}

### The top bar

The top bar runs across the top of every screen. It shows the company logo, the menu toggle, the app name, your current role, and the logout button.

{{figure:topbar-header}}

From the account menu you can open your profile or sign out.


### Page layout

Most screens follow the same pattern, top to bottom:

1. **Page header** — the title, a short description and the main action button (for example *Add Partner* or *Download*).
2. **Filters** — search boxes and dropdowns that narrow what the table shows.
3. **Table or cards** — the records themselves.
4. **Pagination** — page controls at the bottom of the table. Tables show 10 rows per page by default; you can change the rows-per-page selector.

### Tips that apply everywhere

- Clicking a column header on most tables sorts by that column; click again to reverse the order.
- Icon buttons in an **Actions** column show a tooltip describing what they do when you hover over them.
- Numbers that look like links (for example the figures inside a KPI card) are usually clickable and open a detailed list.
- Anything destructive — deleting or cancelling — always asks you to confirm first.`,
    figures: [
      {
        id: "sidebar-collapsed",
        src: sidebarCollapsedShot.url,
        caption: "The sidebar with all groups collapsed.",
        alt: "Control Panel sidebar with collapsed menu groups",
        markers: [
          { n: 1, label: "The page you are on is highlighted in solid green.", x: 78, y: 15, arrowDirection: "left" },
          { n: 2, label: "An arrow on the right means the item is a group — click it to expand.", x: 90, y: 24, arrowDirection: "left" },
          { n: 3, label: "Items without an arrow open a screen directly.", x: 78, y: 65, arrowDirection: "left" },
        ],
      },
      {
        id: "mobile-menu-open",
        src: mobileMenuOpenShot.url,
        caption: "On a phone the sidebar slides out over the page.",
        alt: "Mobile sidebar slid out over the page with the X close button",
        markers: [
          { n: 1, label: "X — closes the menu. Tapping the dimmed area outside it also closes it.", x: 56, y: 6 },
          { n: 2, label: "Tap any item to open that screen; the menu closes automatically.", x: 40, y: 15, arrow: false },
        ],
      },
      {
        id: "mobile-menu-closed",
        src: mobileMenuClosedShot.url,
        caption: "With the menu closed, tap the menu button in the top bar to open it again.",
        alt: "Mobile top bar with the menu button and logo",
        markers: [{ n: 1, label: "Menu button — slides the sidebar out.", x: 14, y: 50 }],
      },
      {
        id: "sidebar-full",
        src: sidebarFullShot.url,
        caption: "The sidebar fully expanded, showing every group and its sub-items.",
        alt: "Control Panel sidebar fully expanded",
        markers: [
          { n: 1, label: "User Management — User Manager and User Groups.", x: 80, y: 12, arrowDirection: "left" },
          { n: 2, label: "Agent Management — ACSL Agents Profile and Partner Agents Profile.", x: 80, y: 26, arrowDirection: "left" },
          { n: 3, label: "Manage Sales — Sell Stove, Sales Records, cancellations, Agreement Images and Map.", x: 80, y: 42, arrowDirection: "left" },
          { n: 4, label: "Settings — Payment Models, Credentials, System Configuration and Tools.", x: 80, y: 87, arrowDirection: "left" },
        ],
      },
      {
        id: "topbar-header",
        src: topbarHeaderShot.url,
        caption: "The top bar across the application.",
        alt: "Top bar showing menu toggle, logo, app name, user role and logout",
        markers: [
          { n: 1, label: "Menu toggle — opens or closes the sidebar.", x: 2, y: 50 },
          { n: 2, label: "Atmosfair logo and tagline.", x: 12, y: 50 },
          { n: 3, label: "Sales Monitoring App — the current application name.", x: 68, y: 50, arrowDirection: "left" },
          { n: 4, label: "Your account menu — shows your role; click to open your profile.", x: 85, y: 50, arrowDirection: "left" },
          { n: 5, label: "Logout — signs you out and returns you to the login screen.", x: 96, y: 50, arrowDirection: "left" },
        ],
      },
    ],
  },

  {
    id: "dashboard",
    title: "4. Dashboard",
    routeKeys: ["dashboard"],
    body: `The dashboard is the first screen after you sign in and gives a summary of activity you are allowed to see. A partner agent sees only their own figures; a partner sees their organisation; a super admin sees everything.

{{figure:dashboard}}

### What is on the dashboard

- **Stove Inventory doughnut** — how the stoves you can see split between **Sold** and **Available**. Hover a segment for the exact count and percentage; the centre shows total stoves received.
- **Sales by Models doughnut** — total sales split by sales (payment) model, so you can see which model is used most.
- **Financial snapshot** — three cards: **Expected Receivable Amount** (total value of sales), **Amount Received** (collected so far) and **Outstanding Balance** (still owed).
- **Monthly Sales chart** — sales per month across the selected year, with a trend line over the bars.
- **Sales by States chart** — number of sales in each state.

### Filters

The green **Sales Overview** bar carries the filters: **Filter by date range**, a **month** dropdown and a **year** dropdown. They apply to the whole dashboard. Use the **X** on the right of the bar to clear them and return to the default view.

### What to do next

The dashboard is a read-only summary. To act on anything you see, use the sidebar to open the relevant module.`,
    figures: [
      {
        id: "dashboard",
        src: dashboardShot.url,
        caption: "The dashboard, top to bottom.",
        alt: "Dashboard showing stove inventory and sales doughnuts, financial snapshot cards, monthly sales and sales by state charts",
        markers: [
          { n: 1, label: "Filters: date range, month and year — plus the X to clear them.", x: 66, y: 6 },
          { n: 2, label: "Stove Inventory — sold versus available, with total stoves received in the centre.", x: 27, y: 21 },
          { n: 3, label: "Sales by Models — total sales split by sales model.", x: 74, y: 21 },
          { n: 4, label: "Financial snapshot: expected receivable, amount received and outstanding balance.", x: 19, y: 40 },
          { n: 5, label: "Monthly Sales — sales per month for the selected year.", x: 56, y: 57 },
          { n: 6, label: "Sales by States — number of sales per state.", x: 23, y: 82 },
        ],
        boxes: [{ x: 3, y: 35, w: 94, h: 9 }],
      },
    ],
  },


  {
    id: "user-management",
    title: "5. User management",
    routeKeys: ["user-management", "user-management-users", "user-management-groups"],
    body: `**Sidebar → User Management**. This is where accounts are created and maintained.

### 5.1 User Manager

The **User Manager** table lists accounts you are allowed to manage, with the person's name, user group (shown as a colour-coded badge next to the name), email, phone, status, when the person was last seen and the actions available to you.

{{figure:user-manager-table}}

**Creating a user**

1. Click **Create User** in the top right of the page header.
2. Enter the **Full Name**, **Email** and **Phone**. The email is the login name and must be unique. Fields marked with a red asterisk are required.
3. Choose the **User Group**. This single choice decides every screen and action the person will have.
4. Depending on the group, extra fields appear:
   - *ACSL agent* — choose the **manager** the agent reports to and the **partners / states** they cover.
   - *Partner agent* — choose the **partner organisation** they belong to.
5. Leave **Auto-generate password** ticked to have the platform create a temporary password, or untick it to type one yourself. The person is asked to change it the first time they sign in.
6. Click **Create User**. The account is created immediately and the person can sign in straight away. **Cancel**, or **Back to User Management** in the top right, returns you to the table without saving.

{{figure:create-user-form}}

**Editing a user**

Click the edit (pencil) action on the row. The same form opens with the record loaded. You can change the name, phone, group and assignments, and you can set a new password from the same form — leave the password fields empty to keep the current one. Click **Save** to apply.

If you change a name, the new name appears everywhere that record is referenced (for example in *Recorded by* and *Cancelled by* columns).

**Disabling and deleting a user**

The second action disables (or re-enables) the login, which is the safer option when someone leaves temporarily — the **Status** badge changes between *Enabled* and *Disabled*. The bin icon deletes the account: confirm in the warning window and the platform first detaches it from anything that depends on it — partner and state assignments, manager links and credentials — and then removes the login. Records the person created (sales, payments) are kept for audit purposes. The three-dot menu holds any remaining options for the row.

**Finding people**

Use **Search by name or email...** to filter the list, and the **All Status** and **All Roles** dropdowns to narrow it to one status or user group. **Reset Filters** clears them all, and the count on the right of the filter bar shows how many users match. The table paginates at the bottom, 10 rows per page by default.

### 5.2 User Groups

**Sidebar → User Management → User Groups** shows the permission matrix: every user group and the screens and abilities it grants. Use it as the reference when deciding which group a new colleague needs. Permissions are set by group — they are not edited person by person.`,
    figures: [
      {
        id: "user-manager-table",
        src: userManagerTableShot.url,
        caption: "User Manager — header, filter bar and the top of the accounts table.",
        alt: "User Management screen with search and filter bar, Create User button and a table row showing name, email, phone, status, last seen and action icons",
        markers: [
          { n: 1, label: "Create User — opens the Create New User form.", x: 92, y: 12, arrowDirection: "left" },
          { n: 2, label: "Search by name or email.", x: 14, y: 38 },
          { n: 3, label: "Status and Roles filters, with Reset Filters to clear them.", x: 40, y: 38 },
          { n: 4, label: "Count of users matching the current filters.", x: 89, y: 38, arrowDirection: "left" },
          { n: 5, label: "User group badge shown beside the person's name.", x: 14, y: 88 },
          { n: 6, label: "Status badge — Enabled or Disabled.", x: 63, y: 88 },
          { n: 7, label: "Row actions: edit, disable/enable, delete and more.", x: 89, y: 88, arrowDirection: "left" },
        ],
      },
      {
        id: "create-user-form",
        src: createUserFormShot.url,
        caption: "The Create New User form.",
        alt: "Create New User form with Full Name, Email, Phone and User Group fields, an Auto-generate password checkbox, and Cancel and Create User buttons",
        markers: [
          { n: 1, label: "Back to User Management — leaves without saving.", x: 90, y: 8, arrowDirection: "left" },
          { n: 2, label: "Required details: Full Name and Email.", x: 14, y: 45 },
          { n: 3, label: "User Group — decides everything the person can see and do.", x: 86, y: 45, arrowDirection: "left" },
          { n: 4, label: "Auto-generate password — untick to set one yourself.", x: 12, y: 66 },
          { n: 5, label: "Create User saves the account; Cancel discards it.", x: 92, y: 87, arrowDirection: "left" },
        ],
      },
    ],
  },


  {
    id: "partner-management",
    title: "6. Partner management",
    routeKeys: ["partners", "partners-profiles"],
    body: `**Sidebar → Partner Management → Partner Profiles**. Partners are the organisations that buy stoves from ACSL and sell them on.

### The partner profiles table

Each row is one partner, with its name, state and contact details, plus action icons at the end of the row.

### How partners are created

Partner records and partner accounts are created automatically when sales records are transferred from the ERP into the Sales & Monitoring App. You do not normally create partners by hand.

Each time records are transferred:

1. New partners found in the transfer are created, together with their partner account.
2. Existing partners are left in place and their stove IDs are updated with the newly transferred serials.

A partner becomes selectable on the sales form and in filters as soon as it exists in the app.

### Editing a partner

Open the edit action on the row, change the details and save. Most partner information can be edited in the Sales & Monitoring App — contact person, phone numbers, email, address, state, branch — but the **partner name cannot be changed**, because it is the link back to the ERP record.

### Partner figures at a glance

From the partner row you can see the total number of agents assigned to the partner, and the total stoves received and sold by that partner.

### Partner credentials

Administrators can open a partner's credential details to view the username and password, copy them, and share them with the partner. Partners are prompted to change these default credentials the first time they log in.

### Purchases from ACSL

The transfer-history action on the row opens the list of stove batches that partner has bought from ACSL, with dates, quantities and serials.

### Filters

Search by partner name, or use the state dropdown to show only partners in one state.`,
  },

  {
    id: "agent-management",
    title: "7. Agent management",
    routeKeys: ["agents-profiles", "partner-agents-profiles"],
    body: `**Sidebar → Agent Management**. Agents are the people who record sales.

### 7.1 ACSL Agents Profile

Lists ACSL agents with their user group, the manager they report to, the partners and states they cover, and live performance figures (stoves allocated, sold, outstanding).

- Use the search box to find an agent by name, or the group filter to show only agents or only managers.
- The **Manage Agent** button on a row opens that person's record in the user edit form, so you can correct details, change assignments or reset the password without leaving the flow.

### 7.2 Partner Agents Profile

The same view for agents that belong to partner organisations, showing which partner each agent works for along with their sales figures.

### What the numbers mean

Figures are live: they recalculate as sales are recorded, so a partner agent who sells a stove will show an increased count here within moments.`,
  },

  {
    id: "performance-reports",
    title: "8. Performance reports",
    routeKeys: ["agents", "performance-report"],
    body: `**Sidebar → Performance Report**. The report screen has tabs for agents, partners and states. They work the same way, so learning one teaches you all three.

### Reading the report

- **KPI cards** at the top summarise the whole tab — for example stoves assigned for sale, sold, awaiting collection.
- **Click a KPI card** to open a window listing every stove ID behind that number. The window has its own search box and an **Export** button that downloads the list as a CSV file.
- The **table** below lists each agent, partner or state with its own figures.
- The **Sell-through** column shows a progress bar: the share of the stoves held that have been sold.
- Status pills and figures inside the table (records to collect, collected, not collected, stoves, sold, not sold) are also clickable and open the same style of filtered list.

### 8.1 Agents Performance

Shows each ACSL agent with their user group as a small blue superscript, the states they cover, their stove and sales figures and their sell-through. Click the **States Assigned** value to see the full list of states. Search by agent name, or filter by user group.

### 8.2 Partners Performance

The same for partner organisations. Search by partner name or filter by state. Each row's figures open the matching stove list.

### 8.3 States Performance

Aggregates everything by state, with gradient summary cards at the top, a sortable table and a sell-through bar per state. Clicking a state opens a breakdown of the partners and agents operating there; those in turn open their own stove lists. Large figures are shown with thousands separators.

### Exporting

Every drill-down window has an **Export** button. The file downloads to your browser's normal download location and can be opened in Excel.`,
  },

  {
    id: "sell-stove",
    title: "9. Recording a sale (Sell Stove)",
    routeKeys: ["sales-create"],
    body: `**Sidebar → Manage Sales → Sell Stove**. This is the single form used by every role to record a sale.

### Before you start

Have ready: the stove serial number, the buyer's and end user's details, the location of the sale, the agreement image or photo, and the customer's signature.

### 9.1 Filling in the form

**Sale details**

| Field | Meaning | Required |
| --- | --- | --- |
| Partner | The organisation the stove is being sold under. Pre-filled if your account belongs to one partner. | Yes |
| Sales model | The payment plan (outright or instalment). Only models assigned to the chosen partner are listed; if none are assigned, all active models appear. | Yes |
| Stove serial | The unique ID printed on the stove. Only serials available to the chosen partner appear in the list. | Yes |
| Amount | The sale value. Filled from the sales model and can be adjusted where allowed. | Yes |

**Buyer & end user**

The fields are in the order you normally collect them: End User First Name, End User Surname, End User Phone, AKA, then the *same as contact person* checkbox, then Contact Person / Buyer and Contact Phone.

- Tick **Select if End User is same as Contact Person** and the platform copies the end user's first name and surname into *Contact Person / Buyer* and the end user's phone into *Contact Phone*, so you do not type them twice.
- **Phone numbers** must be valid Nigerian numbers in one of these forms: \`08031234567\`, \`+2348031234567\` or \`2348031234567\`. Anything else is rejected with a message under the field.
- **End user phone must be unique.** If the number already exists the form tells you so and shows the transaction it belongs to, so you can check whether this is a duplicate entry.

**Location**

Choose **State**, then **LGA**. The LGA list depends on the state you picked, so always set the state first.

**Agreement image**

Attach the signed agreement. You can either **upload** a file or click the camera button to **take a photo** with the device camera (works on both phones and laptops). Review the preview and retake if it is not legible.

**Digital signature**

The signature pad is locked by default. Flip the toggle to unlock it, then let the customer sign with a finger or mouse. You can also **Take Photo** of a signature or upload an image of one instead of signing on screen. Use **Clear** to start again.

### 9.2 Submitting

Click **Submit**. The platform validates every field, checks the stove serial is still available and that the end user phone is not already used, then saves the sale.

**What happens next**

- The stove serial is marked as sold and can no longer be selected for another sale.
- The record appears immediately in **Sales Records**, and the end user appears in **Stove Users Data**.
- Your name is stored as *Recorded by*, with the date and time.
- If the sales model is an instalment plan, the payment schedule starts and the sale appears in the sales tracking bar according to its next due date.

If submission fails, the message tells you why — see the troubleshooting chapter at the end of this guide.

### 9.3 Editing a sale you already recorded

From **Sales Records**, click the pencil (Edit Sale) icon on the row. The same form opens with every value recalled, including the state and LGA. All the editable details — amounts, names, phone numbers, location, images and signature — can be changed. The partner and stove serial stay locked because they identify the sale. Save to apply; the change is stamped with your name and the time.`,
  },

  {
    id: "sales-records",
    title: "10. Sales records & financial reports",
    routeKeys: ["sales", "sales-financial-reports"],
    body: `**Sidebar → Manage Sales → Sales Records**. Every completed sale you are allowed to see is listed here.

### Reading the table

Columns cover the transaction reference, date, partner, agent, end user, stove serial, sales model, amount and the audit columns showing who recorded the sale and when. Instalment columns are colour tinted so they stand out:

- **Paid** — how many instalments have been received and their value.
- **Outstanding** — what is still owed.
- **Next due** — the date of the next expected payment.

### The sales tracking bar

Above the table is a row of coloured chips: **Overdue**, **Due today**, **Due in 7 days**, **Due in 14 days**, **Due in 30 days**, each with a live count. Click a chip to filter the table to just those sales; click it again to clear. Use this every morning to see who to call.

### Filters

The filter row lets you narrow by search text, partner, agent, state, sales model, status, and month/year, plus a date-range picker (future dates cannot be selected). **Clear filters** resets everything. The record count is shown directly above the table.

### Actions on a row

| Action | What it does |
| --- | --- |
| **Pay** | Records an instalment payment against the sale |
| **Pencil (Edit Sale)** | Reopens the sale in the sales form for correction |
| **Payment History & Receipts** | Shows every payment taken, who recorded each one, the running balance and the receipt for each payment |
| **Receipt** | Opens the printable receipt; print it or save it as a PDF |
| **Attachments** | Shows the agreement image and signature captured at the point of sale |
| **Cancel** | Cancels the sale — a reason is compulsory |

### Taking a payment

1. Click **Pay** on the row.
2. Enter the amount received and the date.
3. Save. The outstanding balance and next due date update immediately, and the payment appears in the payment history with your name against it.

### Cancelling a sale

Click **Cancel**, read the warning, type the **reason for cancellation** (this is compulsory) and confirm. The sale moves to **Cancelled Transactions**, the stove serial is released back to available stock so it can be sold again, and your name is recorded as the person who cancelled it.

### Exporting and printing

Use the export button to download the current, filtered view as a CSV file for Excel. Receipts print directly from the receipt window.`,
  },

  {
    id: "cancelled",
    title: "11. Cancelled transactions & purchases",
    routeKeys: ["sales-cancelled", "sales-cancelled-purchases"],
    body: `### Cancelled Transactions

**Sidebar → Manage Sales → Cancelled Transactions** lists sales that were cancelled, with the original sale details, the **reason for cancellation**, the date and the **Cancelled By** column showing who did it.

Cancelling is not deletion: the record stays for audit, but the stove serial returns to available stock and the sale no longer counts towards sales figures or outstanding balances.

### Cancelled Purchases

**Sidebar → Manage Sales → Cancelled Purchases** lists stove purchases from ACSL that were reversed. The serials involved are returned to ACSL stock and stop counting towards the partner's holdings.`,
  },

  {
    id: "stove-tracking",
    title: "12. Track stoves",
    routeKeys: ["stove-management", "stove-manager"],
    body: `**Sidebar → Track Stoves**. This is the register of every stove serial in the system.

### Statuses

| Status | Meaning |
| --- | --- |
| Available | In ACSL stock, not yet given to a partner |
| Allocated / transferred | Held by a partner, ready to sell |
| Sold | Recorded against an end user on a sale |
| Returned to available | Released again because a sale or purchase was cancelled |

### What you can do

- **Search** for a serial to see exactly where it is and its full history.
- **Filter** by status, partner or state to see, for example, everything still unsold with one partner.
- **Allocate / transfer** stoves to a partner (where your role allows it) by selecting the serials or a range and choosing the receiving partner. The transfer is recorded and appears under *Purchases from ACSL*.
- **Import** serials in bulk from a CSV file when a new batch arrives.
- **Export** the current filtered list.

### Purchases from ACSL

**Sidebar → Manage Sales → Purchases from ACSL** shows the transfer history: every batch a partner received, when, how many and which serials. This is the paper trail behind a partner's stock figure.`,
  },

  {
    id: "end-user-records",
    title: "13. Stove Users Data",
    routeKeys: ["end-user-records"],
    body: `**Sidebar → Stove Users Data** is the register of the people who own the stoves — one row per end user record created by a sale.

### The table

Columns cover the end user's name and phone, the stove serial, the partner and agent, the location, the sale date and the **last modified by** audit column with the name and date of the last change.

### Actions

| Icon | Action |
| --- | --- |
| Eye | View the full record, including everything captured on the sales form |
| Pencil | Edit the record |
| Trash | Delete the record |

**Editing** opens a window where every detail can be corrected. Save, and the record is stamped with your name and the current date in *last modified by*.

**Deleting** shows a warning first and requires a **reason**. The linked sale is moved to cancelled transactions and the stove serial is released back to available stock, so use this only for genuine errors.

### Searching and exporting

Use the search box and filters to narrow the list, then export the filtered results as CSV.`,
  },

  {
    id: "agreement-images",
    title: "14. Agreement images",
    routeKeys: ["agreement-images"],
    body: `**Sidebar → Manage Sales → Agreement Images**. Use this screen to retrieve the signed agreement for any stove.

1. Type or paste the **stove serial** into the lookup box.
2. Press Enter.

**What you get back**

- If an agreement image was uploaded or photographed at the point of sale, it is displayed. Click it to zoom.
- If no image was captured, the platform builds the **sales agreement document** for that stove from the sale record and shows a preview of the PDF under *User Agreement (Generated)*.

Either way you can **download** what is shown. If the serial has no sale against it at all, the screen tells you so rather than showing a blank page.`,
  },

  {
    id: "map",
    title: "15. Map",
    routeKeys: ["map"],
    body: `**Sidebar → Manage Sales → Map** plots recorded sales geographically so you can see coverage at a glance.

- Each marker is a sale location derived from the state and LGA captured on the sales form.
- Zoom and pan with the usual map controls; clusters split into individual markers as you zoom in.
- Click a marker to see the sale summary behind it.

Because the map is built from the location fields on the sales form, choosing the correct state and LGA when recording a sale is what keeps it accurate.`,
  },

  {
    id: "settings",
    title: "16. Settings",
    routeKeys: [
      "settings",
      "settings-payment-models",
      "settings-credentials",
      "settings-system-config",
      "settings-tools",
      "payment-models",
    ],
    body: `**Sidebar → Settings**. These screens change how the whole platform behaves, so treat them with care.

### Payment models

The sales (payment) models offered on the sales form: outright and instalment plans, with their price, deposit, number of instalments and interval. Create a model here, then assign it to the partners that may use it from the partner profile screen. Changing a model does not alter sales already recorded under it.

### Credentials

The API keys and integration credentials the platform uses. Values are masked; regenerate or replace them only when you are sure, because anything using the old value stops working immediately.

### System configuration

General settings including **email notification** options — which events send an email and to whom. Save at the bottom of the screen to apply.

### Tools

Administrative utilities for data maintenance and one-off corrections. Each tool explains what it does before it runs, and actions here can be far-reaching, so read the description first.`,
  },

  {
    id: "api-documentation",
    title: "17. API documentation",
    routeKeys: ["docs"],
    superAdminOnly: true,
    body: `**Sidebar → API Documentation** (super admins only) describes the public **End User Records** endpoint that external systems can call to pull stove-user data.

The page covers the endpoint address, the bearer-token authentication header, every query parameter (date range, state, LGA, partner and so on) and the exact shape of the response.

### Try it

The *Try it* panel lets you build and run a real request from the browser:

1. Pick dates with the calendar pickers and choose the state and LGA from the cascading dropdowns.
2. Click the run button.
3. The live response appears below, together with the equivalent request you can copy into your own code.

Keep the API key secret — anyone holding it can read the same data.`,
  },

  {
    id: "workflows",
    title: "18. Complete workflows",
    body: `Screens make more sense when you can see how information moves through the system end to end.

### 18.1 Stock to sale to payment

1. **Stoves arrive.** Serials are added to Track Stoves (individually or by CSV import) with the status *available*.
2. **Allocation.** ACSL allocates a batch to a partner. The serials move to that partner and the batch appears under *Purchases from ACSL*.
3. **Sale.** An agent opens **Sell Stove**, selects the partner, sales model and serial, captures the buyer and end user, location, agreement image and signature, and submits.
4. **Immediately after submission** the serial becomes *sold*, the sale appears in **Sales Records**, the customer appears in **Stove Users Data**, and the agreement is retrievable from **Agreement Images**.
5. **Collection.** For instalment plans the schedule starts. Each morning, use the tracking bar on Sales Records (*Overdue*, *Due today*, *Due in 7 days*) to see who to chase. Record each payment with **Pay**; the balance, next due date and payment history update at once.
6. **Reporting.** Every step feeds the dashboard and the agent, partner and state performance reports, and can be exported to CSV.

### 18.2 Onboarding a new person

1. A super admin (or a manager, within their scope) creates the account in **User Manager** and picks the user group.
2. For ACSL agents, the manager and the partners or states they cover are set at the same time; for partner agents, the partner is set.
3. The person signs in with the temporary password and is required to set their own.
4. Their sidebar shows only what their group allows, and their new figures start appearing in the performance reports as soon as they record their first sale.

### 18.3 Correcting or reversing a mistake

- **Wrong details on a sale** — use the pencil (Edit Sale) icon on Sales Records and correct the record. The change is stamped with your name.
- **The sale should not have happened** — cancel it with a reason. It moves to Cancelled Transactions and the stove serial returns to available stock.
- **A batch was transferred in error** — reverse it; the serials return to ACSL and the reversal is listed under Cancelled Purchases.
- **Duplicate customer** — the sales form blocks a repeated end user phone and names the existing transaction, so check that record before creating a new one.

Nothing is ever silently deleted: cancellations and edits keep an audit trail showing who did what and when.`,
  },

  {
    id: "reference",
    title: "19. Statuses, buttons & fields reference",
    body: `### Common action icons

| Icon | Meaning |
| --- | --- |
| Eye | View the full record |
| Pencil | Edit the record |
| Trash | Delete or cancel (always confirmed first) |
| Download | Export the current view or save the document |
| Search | Filter the list below |
| Camera | Capture an image with the device camera |

### Stove statuses

*Available* → in ACSL stock · *Allocated / transferred* → held by a partner · *Sold* → recorded against an end user · *Returned to available* → released after a cancellation.

### Sale statuses

*Active* → a live sale with payments possibly outstanding · *Completed* → fully paid · *Cancelled* → reversed, with a recorded reason and the person who cancelled it.

### Payment terms

- **Amount** — the total value of the sale.
- **Paid** — the sum of instalments received.
- **Outstanding** — amount less paid.
- **Next due** — the date the next instalment is expected; this drives the tracking bar chips.
- **Sell-through** — the percentage of stoves held that have been sold.

### Fields that are always required on the sales form

Partner, sales model, stove serial, amount, end user first name and surname, end user phone, contact person and contact phone, state and LGA.`,
  },

  {
    id: "troubleshooting",
    title: "20. Troubleshooting & common messages",
    body: `| Message or symptom | What it means | What to do |
| --- | --- | --- |
| *A customer with this phone number already exists* | The end user phone is already on another sale; the message names that transaction | Open the named transaction and check. If it really is a new customer, confirm the correct number |
| *Invalid phone number* | The number is not in an accepted Nigerian format | Enter it as \`08031234567\`, \`+2348031234567\` or \`2348031234567\` |
| The stove serial is not in the list | The serial is not available to the selected partner — it may be unallocated, already sold or allocated elsewhere | Check the serial in Track Stoves and allocate it to the partner first |
| *Organization ID not found. Please log in again.* | Your session lost its organisation link | Sign out and back in. If it persists, ask an administrator to check your partner assignment |
| The LGA list is empty | No state has been chosen yet | Select the state first; the LGA list then loads |
| *You are not authorised to view this page* | Your user group does not include that screen | Use the sidebar to return to a screen you can access, or ask a super admin about your group |
| Nothing appears in a report | The filters are too narrow, or there is genuinely no data in that period | Click **Clear filters** and widen the date range |
| The agreement image is missing | No image was uploaded at the point of sale | The platform shows the generated agreement PDF instead; download that |
| The page reloads by itself once | A new version was released and the browser refreshed to load it | Nothing to do; saved work is unaffected |
| You are returned to the login screen | The session expired | Sign in again |

If a problem is not listed here, note the exact message, the screen you were on and what you were doing, and send it to your administrator — that is usually enough to resolve it quickly.`,
  },
];
