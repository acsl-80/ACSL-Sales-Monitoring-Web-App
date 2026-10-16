# Brain-codes test environment: setup and hand-off

Step 9 of the [release runbook](phone-and-buyer-rule-release.md), the part a person does. Written 2026-10-16.

The test environment is the main-schema sandbox (Supabase ref `vgsotbftajnktwofzpnu`, git branch `preview/main-schema`). It runs the code production runs (`38a61329`), checked file by file on 2026-10-16. Nothing done there reaches production or the field.

Brain-codes' checks (handover section 9) need sales logins on two different partners. The sandbox has the partners and their stock already. One login exists; this guide makes the second.

| Partner | Login | Stove IDs available (2026-10-16) |
| --- | --- | --- |
| Amina Sales Model Gombe | `agent@preview.acsl.test` (partner agent), exists | 199 |
| Hakimi Partner Kano | none yet: made in part 1 | 198 |

## 1. Make the second login (about 5 minutes)

1. Open the sandbox web app: `https://acsl-sales-monitoring-web-app-git-prev-96bcbe-acsl-80s-projects.vercel.app`. If Vercel asks you to sign in, use the Vercel account on the ACSL team. This address is the sandbox, not the live site; the live site is `acsl-sales-monitoring-web-app.vercel.app`.
2. Sign in as the sandbox super admin, `admin@preview.acsl.test`. Its password is `PREVIEW_PASSWORD` in `e2e/helpers.ts`. It works only on test databases.
3. Open **Settings, User Management** (`/settings/user-management`) and press **Create User**.
4. Fill in:
   - **Full name:** `Brain-codes Test Agent Kano`
   - **Email:** `braincodes.kano@preview.acsl.test`
   - **User Group:** Partner Agent
   - **Assign Partner:** type `Hakimi` and pick **Hakimi Partner Kano**. The list shows results only after you type.
   - **Password:** leave "Auto-generate password" on.
5. Press **Create User**. The confirmation shows the password once: copy it now. If you miss it, **Settings, Credentials** (`/settings/credentials`) shows it again.
6. Check that the new user is in the list as a partner agent of Hakimi Partner Kano. Or ask Claude to read it back from the sandbox.

Choose **Partner Agent**, not Partner. The Create User form saves a Partner login with no organisation (see "Found on the way" below). A partner agent is also what a field seller is.

## 2. Gather what to send

- **Server address:** `https://vgsotbftajnktwofzpnu.supabase.co`
- **App key:** the sandbox's anon (public) key. In the Supabase dashboard, open the sales project, then **Branches**, `preview/main-schema`, **Settings, API Keys**, and copy the `anon` key. These two go in the app's `.env` as `SUPABASE_URL` and `SUPABASE_ANON_KEY` for a test build.
- **Login 1:** `agent@preview.acsl.test`, Amina Sales Model Gombe, the preview password.
- **Login 2:** `braincodes.kano@preview.acsl.test`, Hakimi Partner Kano, the password from part 1.

## 3. Send it privately

Send the message below directly to the Brain-codes developer: an email or a direct message, never a group, a pull request, an issue or the repository. Fill the four blanks from part 2.

> Hello,
>
> The phone number and buyer rule is live on the sales server since this morning (16 October). You can start 1.0.19 now.
>
> The handover is in the sales-web repo, `docs/contractor/sales-mobile-phone-buyer-rule.md`. The test cases for the buyer key are in `supabase/functions/_shared/buyer-key-vectors.json`. Both are on main.
>
> Please build against our test environment, which runs the same server code as production:
>
> - SUPABASE_URL: [server address]
> - SUPABASE_ANON_KEY: [app key]
>
> Two test logins, on two different partners, for the checks in section 9:
>
> - Amina Sales Model Gombe: agent@preview.acsl.test, password [preview password]
> - Hakimi Partner Kano: braincodes.kano@preview.acsl.test, password [password from part 1]
>
> Each partner has about 200 test stove IDs to sell. Everything in this environment is test data, so record whatever you need.
>
> Please keep the test build away from field phones, and do not release 1.0.19 until we have been through section 9 together. When you are ready, send us what section 10 asks for: the PR link and build number, the Dart test output, the screenshots, and anything in the handover that did not match the code.
>
> Phone app 1.0.18 keeps working against the new server in the meantime, so there is no rush beyond the field team's wait for family sales on the phone.
>
> Thank you.

## 4. What happens next

1. Brain-codes builds 1.0.19 against the sandbox and runs the section 9 checks. We do the ones marked "together" with them.
2. They send the section 10 items. We check them against the handover.
3. On our word they publish 1.0.19 through `app_releases`. Field agents get the update prompt.
4. Then the field team can record a family's second stove on the phone. Until then it goes through the web Sell Stove page.

## Found on the way

Two gaps in the web app's admin screens, on production as on the sandbox. Neither touches the phone and buyer rule.

- **No screen creates a partner or adds stove IDs.** The Partners page still mounts the Add Partner form, which creates the partner, its login and its stove IDs in one go, but nothing opens it any more. Its button went in an earlier "Changes" commit. A new partner or new stock can only be added by a call to `external-sync` or `upload-stove-ids-csv`.
- **Create User saves a Partner login with no organisation.** For the Partner role the form shows the partner picker but sends `organization_id: null`, at create and at edit. A partner login made there belongs to no partner, and create-sale refuses its sales ("User must belong to an organization"). Partner Agent logins are unaffected.
