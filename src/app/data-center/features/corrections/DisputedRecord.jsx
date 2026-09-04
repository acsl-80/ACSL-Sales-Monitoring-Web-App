import { Section, Detail, Grid } from "../stove-record/parts";
import { dateOf, whenOf } from "../../lib/when";
import { formatCurrency } from "@/app/utils/formatCurrency";
import { UserRound, MapPin, Flame, Banknote, PhoneCall, Route, MessageSquareWarning } from "lucide-react";

/**
 * The record, whole, with the disputed items marked.
 *
 * Five blocks in the same order the call brief uses (who, where, stove, money,
 * what happened on the phone), then the journey. A disputed field carries an
 * amber ring and the word, and the opener's note sits above the first block so
 * the reader knows what they are looking for before they look.
 */

function Note({ episode }) {
  if (!episode?.note) return null;
  return (
    <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p>
        <span className="font-semibold">Call centre{episode.opened_by_name ? `, ${episode.opened_by_name}` : ""}:</span> "{episode.note}"
      </p>
    </div>
  );
}

const money = (v) => (v == null || v === "" ? null : formatCurrency(Number(v)));
const yesNo = (v) => (v == null ? null : v ? "Yes" : "No");

const OUTCOME_WORD = {
  fully_verified: "Verified",
  partially_verified: "Unverified (partly verified)",
  unreachable: "Unreachable",
  not_verified: "Yet to be resolved",
};

export default function DisputedRecord({ data, episode, disputed }) {
  const r = data.record ?? {};
  const s = data.sale ?? {};
  const t = data.transfer ?? null;
  const is = (k) => disputed.has(k);

  const stages = [
    { key: "transferred", title: "Transferred", when: t?.transfer_date, done: Boolean(t) },
    { key: "sold", title: "Sold", when: r.sales_date, done: Boolean(r.sales_date) },
    { key: "digitised", title: "Digitised", when: r.created_at, done: Boolean(r.created_at) },
    { key: "called", title: "Called", when: r.last_attempt_at, done: Number(r.attempt_count ?? 0) > 0 },
    { key: "verified", title: "Verified", when: null, done: r.verification_outcome === "fully_verified" },
  ];

  return (
    <div className="space-y-3">
      <Note episode={episode} />

      <Section icon={UserRound} title="Buyer">
        <Grid>
          <Detail label="End user" value={s.end_user_name ?? r.end_user_name} disputed={is("end_user_name")} />
          <Detail label="Also known as" value={s.aka ?? r.aka} disputed={is("aka")} />
          <Detail label="Phone" value={s.phone ?? r.primary_phone} disputed={is("phone")} hint={r.corrected_phone ? `Call centre heard ${r.corrected_phone}` : undefined} />
          <Detail label="Other phone" value={s.other_phone ?? r.alternative_phone} disputed={is("other_phone")} />
          <Detail label="Contact person" value={s.contact_person ?? r.buyer_name} disputed={is("contact_person")} />
          <Detail label="Contact phone" value={s.contact_phone ?? r.buyer_phone} disputed={is("contact_phone")} />
        </Grid>
      </Section>

      <Section icon={MapPin} title="Where">
        <Grid>
          <div className="col-span-2">
            <Detail label="Address" value={s.full_address ?? r.user_residential_address} disputed={is("full_address")} hint={r.corrected_address ? `Call centre heard ${r.corrected_address}` : undefined} />
          </div>
          <Detail label="State" value={s.state_backup ?? r.user_state} disputed={is("state_backup")} />
          <Detail label="LGA" value={s.lga_backup ?? r.user_lga} disputed={is("lga_backup")} />
        </Grid>
      </Section>

      <Section icon={Flame} title="Stove and sale">
        <Grid>
          <Detail
            label="Stove ID"
            value={r.stove_serial_no ?? s.stove_serial_no}
            disputed={is("stove_serial_no")}
            hint={r.stated_serial ? `Buyer read ${r.stated_serial} off the plate` : undefined}
          />
          <Detail label="Transaction" value={r.transaction_id} />
          <Detail label="Sale date" value={dateOf(s.sales_date ?? r.sales_date, null)} disputed={is("sales_date")} />
          <Detail label="Transfer" value={t?.transaction_id} hint={t?.sales_rep ? `sales rep ${t.sales_rep}` : undefined} />
          <Detail label="Partner" value={r.partner_name} />
          <Detail label="Branch" value={r.retailer_branch} />
          <Detail label="Pots" value={s.pot_quantity ?? r.pot_quantity} disputed={is("pot_quantity")} />
          <Detail label="Heat retention device" value={yesNo(s.heat_retention_device ?? r.heat_retention_device)} disputed={is("heat_retention_device")} />
          <Detail label="Previous stove" value={s.previous_stove_type ?? r.previous_stove_type} disputed={is("previous_stove_type")} />
          <Detail label="Recorded through" value={r.platform} />
        </Grid>
      </Section>

      <Section icon={Banknote} title="Money">
        <Grid>
          <Detail label="Sales model" value={r.sales_model} />
          <Detail label="Amount" value={money(s.amount ?? r.amount)} disputed={is("amount")} />
          <Detail label="Received" value={money(s.total_paid ?? r.total_paid)} disputed={is("total_paid")} />
          <Detail label="Payment status" value={r.payment_status} />
          <Detail label="Signature" value={s.signature === true ? "Drawn" : s.signature === false ? "None" : null} disputed={is("signature")} />
          <Detail label="Agreement image" value={yesNo(s.agreement_image_id)} disputed={is("agreement_image_id")} />
        </Grid>
      </Section>

      <Section icon={PhoneCall} title="Call centre">
        <Grid>
          <Detail label="Outcome" value={OUTCOME_WORD[r.verification_outcome] ?? r.verification_outcome} />
          <Detail label="Calls made" value={r.attempt_count == null ? null : String(r.attempt_count)} />
          <Detail label="Last call" value={whenOf(r.last_attempt_at, null)} />
          <Detail label="Last outcome" value={r.call_outcome} />
          <Detail label="Agent" value={r.call_agent} />
          <Detail label="Agent's comments" value={r.other_comments} />
        </Grid>
        {(data.attempts ?? []).length > 0 && (
          <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100 text-sm">
            {data.attempts.map((a) => (
              <li key={a.attempt_no} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5">
                <span className="text-xs text-gray-500">Call {a.attempt_no}</span>
                <span className="font-medium text-gray-900">{a.outcome ?? "no outcome"}</span>
                <span className="text-xs text-gray-500">{whenOf(a.attempted_at, "")}{a.agent ? ` by ${a.agent}` : ""}</span>
                {a.note && <span className="w-full text-xs text-gray-600">"{a.note}"</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={Route} title="Journey">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {stages.map((st) => (
            <li
              key={st.key}
              className={`rounded-lg border px-3 py-2 ${
                st.done
                  ? "border-(--dc-accent)/35 bg-(--dc-accent-soft)/40 text-(--dc-accent-strong)"
                  : "border-gray-200 bg-white text-gray-500"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide">{st.title}</p>
              <p className="mt-0.5 text-[11px] tabular-nums opacity-70">{st.when ? dateOf(st.when, "") : st.done ? "" : "not yet"}</p>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
