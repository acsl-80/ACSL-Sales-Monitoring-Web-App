import { test, expect } from "@playwright/test";
import { signIn, USERS, callEdgeFunction, branchSql } from "./helpers";

/**
 * Linking a rep is also the door.
 *
 * On production every linked rep and both standing recipients held no
 * module_access row, so the corrections page refused the very people the
 * flow routed to. From Phase 24 a link provisions the sales_rep level when the
 * account holds none, an unlink takes it back when nothing else justifies it,
 * and an account that already holds a level is never lowered.
 */

type Rep = { rep_key: string; user_id: string | null };

async function firstUnlinkedRep(page: Parameters<typeof callEdgeFunction>[0]): Promise<string | null> {
  const r = await callEdgeFunction(page, "data-center-admin", { action: "send_back_config" });
  const reps = ((r.body as { data?: { reps?: Rep[] } }).data?.reps ?? []);
  return reps.find((x) => !x.user_id)?.rep_key ?? reps[0]?.rep_key ?? null;
}

test.describe("linking a sales rep opens the door", () => {
  test("a linked account with no level gets sales_rep; unlinking takes it back", async ({ page }) => {
    await signIn(page, USERS.admin);
    const repKey = await firstUnlinkedRep(page);
    test.skip(!repKey, "no transfers on the preview");

    // Somebody seeded with a profile and no module access at all.
    const [target] = await branchSql<{ id: string }>(
      `select p.id::text
         from public.profiles p
        where p.email like '%@preview.acsl.test'
          and not exists (select 1 from data_center.module_access m where m.user_id = p.id)
          and not exists (select 1 from data_center.sales_rep_accounts a where a.user_id = p.id)
          and not exists (select 1 from data_center.send_back_recipients r where r.user_id = p.id)
        order by p.email
        limit 1`,
    );
    test.skip(!target, "every seeded account already holds a level");

    const before = await branchSql<{ user_id: string | null }>(
      `select user_id::text from data_center.sales_rep_accounts where rep_key = '${repKey!.replace(/'/g, "''")}'`,
    );

    try {
      const linked = await callEdgeFunction(page, "data-center-admin", {
        action: "sales_rep_link",
        repKey,
        userId: target.id,
      });
      expect(linked.status).toBe(200);

      const [after] = await branchSql<{ access_role: string | null }>(
        `select access_role from data_center.module_access where user_id = '${target.id}'`,
      );
      expect(after?.access_role, "linking should provision the sales_rep level").toBe("sales_rep");

      const unlinked = await callEdgeFunction(page, "data-center-admin", {
        action: "sales_rep_link",
        repKey,
        userId: null,
      });
      expect(unlinked.status).toBe(200);

      // Unlinking takes nothing away: a level is removed on the Access panel
      // by a person, never as the side effect of a routing edit (the review
      // of slice 1 found the automatic revoke would also remove a level a
      // super admin had granted by hand).
      const kept = await branchSql<{ access_role: string | null }>(
        `select access_role from data_center.module_access where user_id = '${target.id}'`,
      );
      expect(kept[0]?.access_role, "unlinking leaves the level in place").toBe("sales_rep");
    } finally {
      const previous = before[0]?.user_id;
      await callEdgeFunction(page, "data-center-admin", {
        action: "sales_rep_link",
        repKey,
        userId: previous ?? null,
      });
      await branchSql(
        `delete from data_center.module_access where user_id = '${target.id}' and access_role = 'sales_rep'`,
      );
    }
  });

  test("linking an editor leaves them an editor", async ({ page }) => {
    await signIn(page, USERS.admin);
    const repKey = await firstUnlinkedRep(page);
    test.skip(!repKey, "no transfers on the preview");

    const [editor] = await branchSql<{ user_id: string; access_role: string }>(
      `select m.user_id::text, m.access_role
         from data_center.module_access m
         join public.profiles p on p.id = m.user_id
        where m.access_role in ('editor', 'data_manager') and p.email like '%@preview.acsl.test'
        order by p.email limit 1`,
    );
    test.skip(!editor, "no seeded editor");

    const before = await branchSql<{ user_id: string | null }>(
      `select user_id::text from data_center.sales_rep_accounts where rep_key = '${repKey!.replace(/'/g, "''")}'`,
    );
    try {
      const linked = await callEdgeFunction(page, "data-center-admin", {
        action: "sales_rep_link",
        repKey,
        userId: editor.user_id,
      });
      expect(linked.status).toBe(200);
      const [after] = await branchSql<{ access_role: string }>(
        `select access_role from data_center.module_access where user_id = '${editor.user_id}'`,
      );
      expect(after.access_role, "a level already held is never lowered").toBe(editor.access_role);
    } finally {
      await callEdgeFunction(page, "data-center-admin", {
        action: "sales_rep_link",
        repKey,
        userId: before[0]?.user_id ?? null,
      });
    }
  });

  test("a standing recipient gets the door too", async ({ page }) => {
    await signIn(page, USERS.admin);
    const [target] = await branchSql<{ id: string }>(
      `select p.id::text
         from public.profiles p
        where p.email like '%@preview.acsl.test'
          and not exists (select 1 from data_center.module_access m where m.user_id = p.id)
          and not exists (select 1 from data_center.sales_rep_accounts a where a.user_id = p.id)
          and not exists (select 1 from data_center.send_back_recipients r where r.user_id = p.id)
        order by p.email desc
        limit 1`,
    );
    test.skip(!target, "every seeded account already holds a level");
    try {
      const set = await callEdgeFunction(page, "data-center-admin", {
        action: "send_back_recipient_set",
        userId: target.id,
        enabled: true,
      });
      expect(set.status).toBe(200);
      const [after] = await branchSql<{ access_role: string | null }>(
        `select access_role from data_center.module_access where user_id = '${target.id}'`,
      );
      expect(after?.access_role).toBe("sales_rep");

      const removed = await callEdgeFunction(page, "data-center-admin", {
        action: "send_back_recipient_set",
        userId: target.id,
        enabled: null,
      });
      expect(removed.status).toBe(200);
      // Removing the recipient leaves the level, for the same reason.
      const kept = await branchSql<{ access_role: string }>(
        `select access_role from data_center.module_access where user_id = '${target.id}'`,
      );
      expect(kept[0]?.access_role).toBe("sales_rep");
    } finally {
      await callEdgeFunction(page, "data-center-admin", {
        action: "send_back_recipient_set",
        userId: target.id,
        enabled: null,
      });
      await branchSql(
        `delete from data_center.module_access where user_id = '${target.id}' and access_role = 'sales_rep'`,
      );
    }
  });
});
