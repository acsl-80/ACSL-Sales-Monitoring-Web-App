import { useMemo } from "react";
import Link from "@/compat/Link";
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
 * loud - a stove ID somebody else took, a number carrying other stoves, a
 * record already sent back to Sales - because those are not detail, they are
 * the reason this call is different from the last one.
 *
 * COLOUR MEANS SOMETHING HERE
 *
 * Red is stop and read: the record is not what it looks like. Amber is take
 * care: something needs saying on this call. The accent marks the two facts
 * the agent reads aloud - the name and the number - which are the only ones
 * they need at arm's length. Everything else is plain, because a card where
 * everything is highlighted is a card where nothing is.
 */

const money = (v) =>
  v == null || v === "" ? null : `₦${new Intl.NumberFormat("en-NG").format(Number(v))}`;
const date = (v) => (v ? new Date(v).toLocaleDateString() : null);
const words = (v) => (v ? String(v).replace(/_/g, " ") : null);

/** A label and its value. Bold where the agent has to say it out loud. */
function Fact({ label, value, loud = false, hint }) {
  const empty = value == null || value === "";
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={
          empty
            ? "mt-0.5 text-sm italic text-gray-400"
            : loud
              ? "mt-0.5 break-words text-base font-semibold text-(--dc-accent-strong)"
              : "mt-0.5 break-words text-sm font-medium text-gray-900"
        }
      >
        {empty ? "not recorded" : value}
      </p>
      {hint && !empty && <p className="text-[11px] text-gray-500">{hint}</p>}
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

function Group({ icon: Icon, title, children }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <p className="flex items-center gap-1.5 border-b border-gray-100 bg-gray-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
        <Icon className="h-3.5 w-3.5 text-(--dc-accent)" /> {title}
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 p-3 sm:grid-cols-3 lg:grid-cols-4">
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
        <Band tone="stop" icon={ShieldAlert} title="This stove ID is not confirmed">
          <p>
            {r.serial_unconfirmed_reason ??
              "Another caller confirmed this record's stove ID, so it now carries a different one."}
          </p>
          <p className="font-medium">
            Ask which number is on their stove before anything else, and use Fix the
            stove ID below.
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
        <Band tone="warn" icon={Package} title="The buyer read out a different stove ID">
          <p>
            They said <span className="font-mono font-semibold">{r.stated_serial}</span>;
            the record says <span className="font-mono font-semibold">{r.stove_serial_no}</span>.
          </p>
        </Band>
      )}

      {/* --------------------------------------------------------- who to ring */}
      <Group icon={Phone} title="Who you are ringing">
        <Fact
          label="Buyer"
          value={r.resolved_end_user_name ?? r.end_user_name}
          loud
          hint={r.was_corrected && r.corrected_end_user_name
            ? `receipt said ${r.end_user_name}`
            : null}
        />
        <Fact
          label="Phone"
          value={r.resolved_phone ?? r.primary_phone}
          loud
          hint={r.corrected_phone ? `receipt said ${r.primary_phone}` : null}
        />
        <Fact label="Other phone" value={r.resolved_alt_phone ?? r.alternative_phone} />
        <Fact label="Also known as" value={r.aka} />
        <Fact label="Contact person" value={r.buyer_name} />
        <Fact label="Contact phone" value={r.buyer_phone} />
      </Group>

      {/* ------------------------------------------------------ what they have */}
      <Group icon={Package} title="The stove they have">
        <Fact label="Stove ID" value={<span className="font-mono">{r.stove_serial_no}</span>} loud />
        <Fact label="Stock status" value={words(r.stove_stock_status)} />
        <Fact label="Factory" value={r.factory} />
        <Fact label="Pots" value={r.pot_quantity} />
        <Fact
          label="Wonderbox"
          value={r.heat_retention_device == null ? null : r.heat_retention_device ? "Yes" : "No"}
        />
        <Fact label="Cooked on before" value={previousStove} />
      </Group>

      {/* ------------------------------------------------------ the purchase */}
      <Group icon={Wallet} title="What they paid, and to whom">
        <Fact label="Sold on" value={date(r.sales_date)} />
        <Fact label="Amount" value={money(r.amount)} />
        <Fact label="Paid" value={money(r.total_paid)} />
        <Fact
          label="Payment"
          value={
            r.is_installment
              ? `installments · ${words(r.payment_status) ?? "unknown"}`
              : words(r.payment_status)
          }
        />
        <Fact label="Partner" value={r.partner_name} />
        <Fact label="Sold by" value={r.sale_agent_name} />
        <Fact label="Sales model" value={words(r.sales_model)} />
        <Fact label="Branch" value={r.retailer_branch ?? r.partner_branch} />
      </Group>

      {/* ------------------------------------------------------- where they are */}
      <Group icon={MapPin} title="Where they live">
        <Fact
          label="Address"
          value={r.resolved_address ?? r.user_residential_address}
          hint={r.corrected_address ? "corrected on a call" : null}
        />
        <Fact label="State" value={r.resolved_state ?? r.user_state} />
        <Fact label="LGA" value={r.resolved_lga ?? r.user_lga} />
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
      <Group icon={PhoneCall} title="What has happened so far">
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
        <Fact label="Verification" value={words(r.verification_outcome) ?? "nothing concluded"} />
        <Fact label="Typed up" value={date(r.recorded_at)} />
      </Group>

      {r.other_comments && (
        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
            <Flame className="h-3.5 w-3.5 text-(--dc-accent)" /> Notes from earlier calls
          </p>
          <p className="mt-1 text-sm text-gray-800">{r.other_comments}</p>
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
