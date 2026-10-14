import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { branchSql } from "./helpers";
import {
  buyerKey,
  nameKey,
  phoneTail,
  BUYER_KEY_RULES,
} from "../supabase/functions/_shared/buyerKey.ts";

/**
 * Phone number and buyer rule, Phase 0: the groundwork is in place and changes
 * nothing yet (docs/plans/phone-and-buyer-rule.md).
 *
 * What this proves:
 *
 *  1. The buyer key reproduces every row of `buyer-key-vectors.json`, the file
 *     the phone app's Dart implementation is held to as well, and the titles
 *     in that file are the titles the server serves.
 *  2. `public.sales_sharing_phone` returns exactly the live sales on a tail,
 *     leaves a cancelled (archived) sale out, can exclude one sale, and returns
 *     nothing for a tail that is not ten digits.
 *  3. Signed-in users cannot run it; only the server can.
 *  4. `data_center.shared_phones.kind` exists, an insert that does not name it
 *     (as both existing writers do) reads 'shared_number', and a value outside
 *     the two kinds is refused.
 *
 * Red on main: there is no buyerKey.ts, no function and no column.
 */

const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../supabase/functions/_shared/buyer-key-vectors.json", import.meta.url)),
    "utf-8",
  ),
) as {
  titles: string[];
  cases: {
    firstName: string | null;
    surname: string | null;
    joinedName: string | null;
    phone: string;
    phoneTail: string;
    nameKey: string;
    buyerKey: string;
  }[];
};

test.describe("phone and buyer rule: groundwork", () => {
  test("the buyer key reproduces every shared vector", async () => {
    expect(vectors.titles).toEqual(BUYER_KEY_RULES.titles);
    for (const v of vectors.cases) {
      expect(phoneTail(v.phone), JSON.stringify(v)).toBe(v.phoneTail);
      expect(nameKey(v.firstName, v.surname, v.joinedName), JSON.stringify(v)).toBe(v.nameKey);
      expect(await buyerKey(v.phone, v.firstName, v.surname, v.joinedName), JSON.stringify(v)).toBe(
        v.buyerKey,
      );
    }
  });

  test("sales_sharing_phone returns the live sales on a tail and nothing else", async () => {
    const [pick] = await branchSql<{ tail: string; id: string }>(`
      select right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) as tail, id::text
      from public.sales
      where is_archived is not true
        and length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 10
      order by created_at desc
      limit 1`);
    expect(pick, "the branch holds at least one live sale with a phone").toBeTruthy();

    const [cmp] = await branchSql<{
      expected: string[];
      got: string[];
      excluded: string[];
      bad_tail: number;
    }>(`
      select
        coalesce((select array_agg(id::text order by id) from public.sales
                  where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = '${pick.tail}'
                    and is_archived is not true), '{}') as expected,
        coalesce((select array_agg(id::text order by id) from public.sales_sharing_phone('${pick.tail}')), '{}') as got,
        coalesce((select array_agg(id::text order by id) from public.sales_sharing_phone('${pick.tail}', '${pick.id}')), '{}') as excluded,
        (select count(*)::int from public.sales_sharing_phone('12345')) as bad_tail`);
    expect(cmp.got).toEqual(cmp.expected);
    expect(cmp.excluded).not.toContain(pick.id);
    expect(cmp.excluded.length).toBe(cmp.expected.length - 1);
    expect(cmp.bad_tail).toBe(0);

    // A cancelled sale is archived; it must stop counting. Rolled back.
    const rows = await branchSql<{ still_listed: boolean }>(`
      begin;
      set local lock_timeout = '3s';
      update public.sales set is_archived = true where id = '${pick.id}';
      select exists (select 1 from public.sales_sharing_phone('${pick.tail}') where id = '${pick.id}') as still_listed;
      rollback;`);
    expect(rows.at(-1)?.still_listed).toBe(false);
  });

  test("only the server can run sales_sharing_phone", async () => {
    const [p] = await branchSql<{ anon: boolean; authenticated: boolean; server: boolean }>(`
      select has_function_privilege('anon', 'public.sales_sharing_phone(text,uuid)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.sales_sharing_phone(text,uuid)', 'execute') as authenticated,
             has_function_privilege('service_role', 'public.sales_sharing_phone(text,uuid)', 'execute') as server`);
    expect(p).toEqual({ anon: false, authenticated: false, server: true });
  });

  test("the shared-phone register carries a kind, defaulted for the existing writers", async () => {
    const [sale] = await branchSql<{ id: string; tail: string }>(`
      select id::text, right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) as tail
      from public.sales
      where length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 10
        and not exists (select 1 from data_center.shared_phones sp where sp.sale_id = sales.id)
      limit 1`);
    expect(sale, "a sale not yet in the register").toBeTruthy();

    // Written the way data-center-import writes it today: no kind named. Rolled back.
    const inserted = await branchSql<{ kind: string }>(`
      begin;
      insert into data_center.shared_phones (phone_tail, sale_id, source)
        values ('${sale.tail}', '${sale.id}', 'digitalisation');
      select kind from data_center.shared_phones where sale_id = '${sale.id}';
      rollback;`);
    expect(inserted.at(-1)?.kind).toBe("shared_number");

    let refused = false;
    try {
      await branchSql(`
        begin;
        insert into data_center.shared_phones (phone_tail, sale_id, source, kind)
          values ('${sale.tail}', '${sale.id}', 'digitalisation', 'household');
        rollback;`);
    } catch {
      refused = true;
    }
    expect(refused, "a kind outside shared_number and same_buyer is refused").toBe(true);
  });
});
