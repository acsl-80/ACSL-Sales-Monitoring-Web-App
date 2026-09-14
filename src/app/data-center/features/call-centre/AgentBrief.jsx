import { outcomeLabel } from "../../lib/outcome";
import { dateOf } from "../../lib/when";
import { useMemo } from "react";
import Link from "@/compat/Link";
import { fieldLabel } from "@/lib/saleDictionary";
import {
  Phone, MapPin, Package, Wallet, TriangleAlert, PhoneCall, ShieldAlert,
  Users, Flame, CalendarDays,
} from "lucide-react";

/**
 * What the agent reads while the phone is ringing.
 *
 * This card carried four fields - phone, buyer, address, sold - which is
 * enough to dial and not enough to hold the conversation. An agent who cannot
 * say which stove, from which partner, sold by whom, on what terms, with how
 * many pots, is reading from a stub while the customer is talking, and every
 * question they cannot answer is a reason for the customer to doubt the call.
 *
 * So: everything the record knows, arranged the way a call goes. Who you are
 * ringing and on what number, then what they bought, then what it cost, then
 * where they are. The things that change what you should DO come first and
 * loud - a serial number somebody else took, a number carrying other stoves, a
 * record already sent back to Sales - because those are not detail, they are
 * the reason this call is different from the last one.
 *
 * COLOUR MEANS SOMETHING HERE
 *
 * Red is stop and read: the record is not what it looks like. Amber is take
 * care: something needs saying on this call.
 *
 * Below the bands, each block carries the hue of the AREA its facts come from
 * - slate for the stove, olive for the money, ochre for the place, plum for
 * the history, teal for the person, which is the call centre's own. So the
 * colour is wayfinding rather than paint: an agent who has used Stove Records
 * already knows what slate means before reading the heading.
 *
 * The header of each block is solid colour with white text, not a tint. A
 * tinted header on a white card is a suggestion; at a glance, mid-call, with
 * the customer talking, the agent needs the block boundary to be unmissable.
 * Inside the block everything is plain, because a card where everything is
 * highlighted is a card where nothing is - the two exceptions are the name and
 * the number, which are the only facts read out loud.
 */

const money = (v) =>
  v == null || v === "" ? null : `₦${new Intl.NumberFormat("en-NG").format(Number(v))}`;
const date = (v) => dateOf(v, null);
const words = (v) => (v ? String(v).replace(/_/g, " ") : null);

/**
 * A label and its value. Bold where the agent has to say it out loud.
 *
 * A missing value reads "not recorded" in grey italic rather than as a blank.
 * A blank looks like a rendering fault, and an agent who thinks the card is
 * broken stops trusting the parts that are filled in.
 */
function Fact({ label, value, loud = false, hint, tone }) {
  const empty = value == null || value === "";
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={
          empty
            ? "mt-0.5 text-sm italic text-gray-400"
            : loud
              ? `mt-0.5 break-words text-base font-bold ${tone ?? "text-gray-900"}`
              : "mt-0.5 break-words text-sm font-medium text-gray-900"
        }
      >
        {empty ? "not recorded" : value}
      </p>
      {hint && !empty && <p className="text-[11px] text-gray-600">{hint}</p>}
    </div>
  );
}

function Band({ tone, icon: Icon, title, children }) {
  const skin = tone === "stop"
    ? "border-red-300 bg-red-50 text-red-900"
    : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div className={`rounded-lg border p-3 ${skin}`}>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="h-4 w-4 shrink-0" /> {title}
      </p>
      <div className="mt-1 space-y-1 text-sm">{children}</div>
    </div>
  );
}

/**
 * The five hues, written out rather than built from the tone name.
 *
 * Tailwind reads class names as literal strings out of the source; a template
 * like `bg-(--dc-brief-${tone})` produces a class at runtime that was never
 * generated at build time, so the block renders with no background at all.
 * That failure is invisible in a typecheck and in a build, which is why this
 * is a lookup rather than a clever string.
 */
const TONES = {
  who: {
    head: "bg-(--dc-brief-who)",
    edge: "border-(--dc-brief-who)",
    wash: "bg-(--dc-brief-who-soft)/40",
    loud: "text-(--dc-brief-who)",
  },
  stove: {
    head: "bg-(--dc-brief-stove)",
    edge: "border-(--dc-brief-stove)",
    wash: "bg-(--dc-brief-stove-soft)/40",
    loud: "text-(--dc-brief-stove)",
  },
  money: {
    head: "bg-(--dc-brief-money)",
    edge: "border-(--dc-brief-money)",
    wash: "bg-(--dc-brief-money-soft)/40",
    loud: "text-(--dc-brief-money)",
  },
  place: {
    head: "bg-(--dc-brief-place)",
    edge: "border-(--dc-brief-place)",
    wash: "bg-(--dc-brief-place-soft)/40",
    loud: "text-(--dc-brief-place)",
  },
  history: {
    head: "bg-(--dc-brief-history)",
    edge: "border-(--dc-brief-history)",
    wash: "bg-(--dc-brief-history-soft)/40",
    loud: "text-(--dc-brief-history)",
  },
};

function Group({ icon: Icon, title, tone = "who", right, children }) {
  const skin = TONES[tone] ?? TONES.who;
  return (
    <section className={`overflow-hidden rounded-xl border-2 ${skin.edge} bg-white shadow-sm`}>
      <p
        className={`flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white ${skin.head}`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {/*
          The title is its own element, not loose text beside the count.
          Sharing the paragraph made the block's text "What has happened so
          far2 so far", so nothing on the page had the title as its exact
          text - which is how two specs address these blocks.
        */}
        <span>{title}</span>
        {right && <span className="ml-auto font-medium normal-case">{right}</span>}
      </p>
      <div
        className={`grid grid-cols-1 gap-x-4 gap-y-3 p-3 sm:grid-cols-2 lg:grid-cols-4 ${skin.wash}`}
      >
        {children}
      </div>
    </section>
  );
}

export default function AgentBrief({ record }) {
  const r = record ?? {};

  const previousStove = useMemo(() => {
    if (r.previous_stove_type === "other") return r.previous_stove_other ?? "other";
    return words(r.previous_stove_type);
  }, [r.previous_stove_type, r.previous_stove_other]);

  const shares = Array.isArray(r.shares_phone_with) ? r.shares_phone_with : [];

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------ what changes the call */}
      {r.serial_unconfirmed_at && (
        <Band tone="stop" icon={ShieldAlert} title="This serial number is not confirmed">
          <p>
            {r.serial_unconfirmed_reason ??
              "Another caller confirmed this record's serial number, so it now carries a different one."}
          </p>
          <p className="font-medium">
            Ask which number is on their stove before anything else, and use Fix the
            serial number below.
          </p>
        </Band>
      )}

      {shares.length > 0 && (
        <Band tone="warn" icon={Users} title={`This number also carries ${shares.length === 1 ? "another stove" : `${shares.length} other stoves`}`}>
          <p>
            One household can hold several. Check you are speaking about{" "}
            <span className="font-semibold">{r.stove_serial_no}</span> and not one of
            these.
          </p>
          <ul className="flex flex-wrap gap-1.5 pt-0.5">
            {shares.map((o) => (
              <li key={o.sale_id}>
                <Link
                  href={`/data-center/stove/${encodeURIComponent(o.stove_id ?? "")}`}
                  className="inline-block rounded border border-amber-400 bg-white px-1.5 py-0.5 font-mono text-xs text-amber-900 hover:bg-amber-100"
                >
                  {o.stove_id} · {o.buyer ?? "no name"}
                </Link>
              </li>
            ))}
          </ul>
        </Band>
      )}

      {r.correction_state === "open" && (
        <Band tone="warn" icon={TriangleAlert} title="Sent back to Sales">
          <p>
            {r.correction_reason ?? "Waiting on a correction"}
            {r.correction_note ? ` — ${r.correction_note}` : ""}
            {r.correction_requested_at ? ` (${date(r.correction_requested_at)})` : ""}
          </p>
        </Band>
      )}

      {r.serial_matches === false && !r.serial_unconfirmed_at && (
        <Band tone="warn" icon={Package} title="The buyer read out a different serial number">
          <p>
            They said <span className="font-mono font-semibold">{r.stated_serial}</span>;
            the record says <span className="font-mono font-semibold">{r.stove_serial_no}</span>.
          </p>
        </Band>
      )}

      {/* --------------------------------------------------------- who to ring */}
      <Group icon={Phone} title="Who you are ringing" tone="who">
        <Fact
          label={fieldLabel("end_user_name")}
          value={r.resolved_end_user_name ?? r.end_user_name}
          loud
          tone={TONES.who.loud}
          hint={r.was_corrected && r.corrected_end_user_name
            ? `receipt said ${r.end_user_name}`
            : null}
        />
        <Fact
          label={fieldLabel("phone")}
          value={r.resolved_phone ?? r.primary_phone}
          loud
          tone={TONES.who.loud}
          hint={r.corrected_phone ? `receipt said ${r.primary_phone}` : null}
        />
        <Fact label={fieldLabel("other_phone")} value={r.resolved_alt_phone ?? r.alternative_phone} />
        <Fact label={fieldLabel("aka")} value={r.aka} />
        <Fact label={fieldLabel("contact_person")} value={r.buyer_name} />
        <Fact label={fieldLabel("contact_phone")} value={r.buyer_phone} />
      </Group>

      {/* ------------------------------------------------------ what they have */}
      <Group icon={Package} title="The stove they have" tone="stove">
        <Fact
          label={fieldLabel("stove_serial_no")}
          value={<span className="font-mono">{r.stove_serial_no}</span>}
          loud
          tone={TONES.stove.loud}
        />
        <Fact label="Stock status" value={words(r.stove_stock_status)} />
        <Fact label="Factory" value={r.factory} />
        <Fact label={fieldLabel("pot_quantity")} value={r.pot_quantity} />
        <Fact
          label={fieldLabel("heat_retention_device")}
          value={r.heat_retention_device == null ? null : r.heat_retention_device ? "Yes" : "No"}
        />
        <Fact label={fieldLabel("previous_stove_type")} value={previousStove} />
      </Group>

      {/* ------------------------------------------------------ the purchase */}
      <Group icon={Wallet} title="What they paid, and to whom" tone="money">
        <Fact label={fieldLabel("sales_date")} value={date(r.sales_date)} />
        <Fact label={fieldLabel("amount")} value={money(r.amount)} />
        <Fact label={fieldLabel("total_paid")} value={money(r.total_paid)} />
        <Fact
          label="Payment"
          value={
            r.is_installment
              ? `installments · ${words(r.payment_status) ?? "unknown"}`
              : words(r.payment_status)
          }
        />
        <Fact label={fieldLabel("partner_name")} value={r.partner_name} />
        <Fact label="Sold by" value={r.sales_rep} />
        <Fact label="Recorded by" value={r.sale_agent_name} />
        <Fact label={fieldLabel("payment_model_id")} value={words(r.sales_model)} />
        <Fact label={fieldLabel("retailer_branch")} value={r.retailer_branch ?? r.partner_branch} />
      </Group>

      {/* ------------------------------------------------------- where they are */}
      <Group icon={MapPin} title="Where they live" tone="place">
        <Fact
          label={fieldLabel("full_address")}
          value={r.resolved_address ?? r.user_residential_address}
          hint={r.corrected_address ? "corrected on a call" : null}
        />
        <Fact label={fieldLabel("state_backup")} value={r.resolved_state ?? r.user_state} />
        <Fact label={fieldLabel("lga_backup")} value={r.resolved_lga ?? r.user_lga} />
        <Fact label="Ward" value={r.ward} />
        <Fact label="Landmark" value={r.landmark} />
        <Fact
          label="Pinned"
          value={
            r.latitude != null && r.longitude != null
              ? `${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)}`
              : null
          }
        />
      </Group>

      {/* -------------------------------------------------------- call history */}
      <Group
        icon={PhoneCall}
        title="What has happened so far"
        tone="history"
        // Three chases is the point at which the process stops calling and
        // writes the record off, so it belongs in the heading rather than
        // four fields down among the dates.
        right={
          Number(r.attempt_count ?? 0) >= 3
            ? "chased three times"
            : `${Number(r.attempt_count ?? 0)} so far`
        }
      >
        <Fact
          label="Calls made"
          value={r.attempt_count ?? 0}
          hint={Number(r.attempt_count ?? 0) >= 3 ? "chased three times" : null}
        />
        <Fact label="First call" value={date(r.call_date_1)} />
        <Fact label="Second call" value={date(r.call_date_2)} />
        <Fact label="Third call" value={date(r.call_date_3)} />
        <Fact label="Last outcome" value={words(r.call_outcome)} />
        <Fact label="Worked by" value={r.call_agent} />
        <Fact label="Verification" value={outcomeLabel(r.verification_outcome)} />
        <Fact label="Typed up" value={date(r.recorded_at)} />
      </Group>

      {r.other_comments && (
        <section className="overflow-hidden rounded-xl border-2 border-(--dc-brief-history) bg-white shadow-sm">
          <p className="flex items-center gap-2 bg-(--dc-brief-history) px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">
            <Flame className="h-4 w-4 shrink-0" /> Notes from earlier calls
          </p>
          <p className="bg-(--dc-brief-history-soft)/40 px-3 py-2.5 text-sm text-gray-900">
            {r.other_comments}
          </p>
        </section>
      )}

      <p className="flex items-center gap-1.5 text-xs text-gray-500">
        <CalendarDays className="h-3.5 w-3.5" />
        Anything corrected on a call replaces what was digitalised. The receipt
        value is kept and shown beneath it.
      </p>
    </div>
  );
}
