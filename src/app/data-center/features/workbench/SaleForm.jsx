import { useMemo, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import StateLgaSelect from "../../components/StateLgaSelect";
import ImageUploadSection from "@/app/components/ui/ImageUploadSection";
import SignatureCanvas from "@/app/components/ui/SignatureCanvas";
import adminSalesService from "@/app/services/adminSalesService";
import { validateSalesForm } from "@/app/utils/salesFormValidation";
import { generateTransactionId } from "@/app/utils/salesFormUtils";
import { fieldLabel, fieldOptions } from "@/lib/saleDictionary";
import { Camera, FileText, Loader2, TriangleAlert } from "lucide-react";

/**
 * The sale, exactly as Sell Stove asks for it.
 *
 * The first version of this asked for thirteen fields and left out the stove
 * set, the cooking habits, the six consents, the signature and both
 * photographs. That was not a smaller form, it was a different one: a record
 * typed here would have reached public.sales missing everything the agreement
 * document is printed from, and the two ways into the same table would have
 * produced two different kinds of sale.
 *
 * So this shares rather than replicates. `validateSalesForm` is the sales
 * app's own validator, `ImageUploadSection` and `SignatureCanvas` are its own
 * components, and `adminSalesService.uploadImage` is its own upload path. None
 * of them are copied here, which is what makes "arrives at the same place"
 * true rather than intended. They are imported read-only: this module still
 * hand-edits exactly two files outside itself.
 *
 * The order is the order the paper agreement reads, so a typist works down the
 * page with the receipt beside them.
 */

const INPUT =
  "w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none disabled:bg-gray-50";

/** The six consents, worded as the paper agreement words them. */
export const TERMS = [
  { key: "poaGoverned", label: "PoA / UNFCCC governed - stove subsidised by Carbon Credits" },
  { key: "monitoring", label: "Agreed to cooperate for monitoring purposes" },
  { key: "noResell", label: "Agreed not to resell the stove" },
  { key: "emissionReductions", label: "Ceded emission reductions to atmosfair gGmbH" },
  { key: "noExport", label: "Agreed not to take stove outside Nigeria" },
  { key: "demonstration", label: "Received demonstration for efficient firewood usage" },
];

/** The baseline stove choices, worded and valued by the dictionary. */
const PREVIOUS_STOVES = fieldOptions("previous_stove_type");

/** The shape Sell Stove starts from, so the two forms hold the same record. */
export function blankSale() {
  return {
    salesModel: "",
    // Minted here exactly as Sell Stove mints it in the browser. The import
    // path mints one at commit instead, which is why a bench record needs its
    // own: the sales app's validator asks for it before the record is saved,
    // not after.
    transactionId: generateTransactionId(),
    stoveSerialNo: "",
    salesDate: new Date().toISOString().split("T")[0],
    contactPerson: "",
    contactPhone: "",
    endUserName: "",
    endUserSurname: "",
    aka: "",
    stateBackup: "",
    lgaBackup: "",
    phone: "",
    otherPhone: "",
    partnerName: "",
    retailerBranch: "",
    amount: "",
    amountReceived: "",
    addressData: {
      fullAddress: "",
      street: "",
      city: "",
      state: "",
      country: "Nigeria",
      latitude: null,
      longitude: null,
    },
    potQuantity: "",
    heatRetentionDevice: false,
    previousStoveType: "",
    previousStoveOther: "",
    mealsPerDay: "",
    cookingFuelSource: "",
    cookingLocation: "",
    termsAccepted: Object.fromEntries(TERMS.map((t) => [t.key, false])),
    signature: "",
    stoveImageId: "",
    agreementImageId: "",
  };
}

/**
 * The fields the sales app's validator demands that a digitised paper receipt
 * cannot supply, and that nothing downstream requires.
 *
 * The signature is the one. Sell Stove captures a live customer on a pad; a
 * receipt typed here was signed on paper weeks ago, and the paper is the
 * record. The Data Center's own validator (`normalizeRow`), the file import
 * path and `create-sale` all carry `signature` as an optional passthrough and
 * never refuse for its absence; the agreement PDF prints it only when present.
 *
 * Left in force, this one rule stopped every receipt typed at the bench on
 * 2026-09-02 from finishing: ten of ten rows blocked in the browser on
 * "1 field still to sort out", eight of which the server would have accepted
 * as they stood. The typists moved on, autosave wrote drafts, and the
 * confirmation queue truthfully reported "0 waiting, 8 still being typed".
 *
 * Exempted here rather than by copying the validator, so every other rule
 * still comes from the one place the sales app keeps it.
 */
const BENCH_OPTIONAL = ["signature"];

/**
 * Where each thing the validator can refuse lives on the screen, and what a
 * typist calls it. The key is the validator's, the id is the control's, the
 * label is what the error box names. A refusal that only says "2 fields still
 * to sort out" sends somebody hunting down a long form; a refusal that says
 * "State, Amount" and scrolls to State does not.
 */
export const FIELD_META = {
  // In the order the form reads, top to bottom, so the FIRST problem named
  // is the first one a typist reaches. Every label a sale field has comes from
  // the dictionary, so the error box names it as the paper agreement does.
  stoveSerialNo: { id: "wb-endUserName", label: fieldLabel("stove_serial_no") },
  endUserName: { id: "wb-endUserName", label: fieldLabel("end_user_first_name") },
  endUserSurname: { id: "wb-endUserSurname", label: fieldLabel("end_user_surname") },
  phone: { id: "wb-phone", label: fieldLabel("phone") },
  otherPhone: { id: "wb-otherPhone", label: fieldLabel("other_phone") },
  contactPerson: { id: "wb-contactPerson", label: fieldLabel("contact_person") },
  contactPhone: { id: "wb-contactPhone", label: fieldLabel("contact_phone") },
  stateBackup: { id: "wb-stateBackup", label: fieldLabel("state_backup") },
  lgaBackup: { id: "wb-stateBackup", label: fieldLabel("lga_backup") },
  address: { id: "wb-address", label: fieldLabel("full_address") },
  salesDate: { id: "wb-salesDate", label: fieldLabel("sales_date") },
  // The sales app's own reference, not a field on the agreement.
  transactionId: { id: "wb-salesDate", label: "Transaction ID" },
  salesModel: { id: "wb-salesModel", label: fieldLabel("payment_model_id") },
  amount: { id: "wb-amount", label: fieldLabel("amount") },
  amountReceived: { id: "wb-amountReceived", label: fieldLabel("first_payment") },
  termsAccepted: { id: "wb-termsAccepted", label: fieldLabel("terms_accepted") },
  signature: { id: "wb-signature", label: fieldLabel("signature") },
};

/** The problems, in form order, as [key, message] pairs. */
export function problemsInFormOrder(problems) {
  const order = Object.keys(FIELD_META);
  return Object.entries(problems ?? {}).sort(
    ([a], [b]) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999),
  );
}

/**
 * What the sales app itself says is wrong with this record, less the fields a
 * paper receipt cannot answer (`BENCH_OPTIONAL`).
 *
 * Its validator, not a second opinion. A rule that disagreed would mean a
 * record accepted here and refused there, or worse the other way round. The
 * exemption list is the whole of the disagreement, and it is written down.
 */
export function saleProblems(values) {
  const problems = { ...(validateSalesForm(withDefaults(values)) ?? {}) };
  for (const key of BENCH_OPTIONAL) delete problems[key];
  const model = modelProblem(values);
  if (model) problems.salesModel = model;
  return problems;
}

/**
 * The bench's one rule of its own, and it is the server's rule repeated: a
 * receipt with no sales model can only be written when the buyer paid in
 * full. create-sale's outright path records the full amount as paid, and only
 * the installment path, which needs a model, can hold a balance. Asked here so
 * the refusal lands before any request, on the field itself.
 */
export function modelProblem(values) {
  if (String(values.salesModel ?? "").trim()) return null;
  const amount = Number(String(values.amount ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null; // the amount has its own error
  const receivedRaw = String(values.amountReceived ?? "").trim();
  if (receivedRaw === "") {
    return "Pick the sales model on the receipt, or fill in Amount paid if the buyer paid in full.";
  }
  const received = Number(receivedRaw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(received) || received === amount) return null;
  return "The buyer has not paid in full, and the balance is tracked against the sales model.";
}

/**
 * The two fields a receipt implies rather than states.
 *
 * A receipt with one name on it means the buyer and the end user are the same
 * person, and `normalizeRow` already fills the contact from the buyer on the
 * import path. Doing it here as well is what stops the same receipt being
 * accepted through a spreadsheet and refused at the bench.
 */
export function withDefaults(values) {
  const full = [values.endUserName, values.endUserSurname]
    .map((x) => (x || "").trim())
    .filter(Boolean)
    .join(" ");
  return {
    ...values,
    contactPerson: (values.contactPerson || "").trim() || full,
    contactPhone: (values.contactPhone || "").trim() || (values.phone || "").trim(),
  };
}

function Field({ label, htmlFor, required, help, error, children, wide }) {
  return (
    <div className={`scroll-mt-24 ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-gray-700">
        {label}
        {required && (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {/* The ring is the part a typist sees from across the form; the text
          under it is the part they read once they get there. */}
      <div className={error ? "rounded-md ring-2 ring-red-300 ring-offset-1" : ""}>{children}</div>
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : help ? (
        <p className="mt-1 text-xs text-gray-600">{help}</p>
      ) : null}
    </div>
  );
}

function Section({ title, note, children }) {
  return (
    <section>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
        {title}
      </h4>
      {note && <p className="mb-2 text-xs text-gray-600">{note}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

export default function SaleForm({
  values,
  onChange,
  disabled,
  errors = {},
  models = [],
  modelsRestricted = false,
  orderModel = null,
  transactionId = null,
}) {
  const [uploading, setUploading] = useState({ stove: false, agreement: false });
  const [previews, setPreviews] = useState({ stove: null, agreement: null });
  const [uploadError, setUploadError] = useState(null);

  const set = (key, value) => onChange(key, value);
  const setAddress = (key, value) =>
    onChange("addressData", { ...(values.addressData ?? {}), [key]: value });

  const terms = values.termsAccepted ?? {};
  const allTerms = TERMS.every((t) => terms[t.key] === true);

  /**
   * Upload through the sales app's own service.
   *
   * It already falls back from the edge function to a direct storage upload,
   * so a receipt photographed here lands wherever one photographed in Sell
   * Stove lands. Writing a second uploader would have been writing a second
   * place for images to be.
   */
  const upload = async (file, kind) => {
    setUploading((u) => ({ ...u, [kind]: true }));
    setUploadError(null);
    try {
      const type = kind === "stove" ? "stove" : "agreement";
      const res = await adminSalesService.uploadImage(file, type);
      const id = res?.data?.id ?? res?.data?.imageId ?? res?.data?.image_id;
      if (!res?.success || !id) throw new Error(res?.error ?? "Upload failed");
      set(kind === "stove" ? "stoveImageId" : "agreementImageId", id);
      setPreviews((p) => ({ ...p, [kind]: URL.createObjectURL(file) }));
    } catch (err) {
      setUploadError(
        `That image did not upload: ${err?.message ?? "unknown reason"}. ` +
          "Try again, or save a draft and add it later - the rest of the record is kept.",
      );
    } finally {
      setUploading((u) => ({ ...u, [kind]: false }));
    }
  };

  const potOptions = useMemo(() => fieldOptions("pot_quantity"), []);

  return (
    <div className="space-y-5">
      <Section title="Who bought it">
        <Field
          label={fieldLabel("end_user_first_name")}
          htmlFor="wb-endUserName"
          required
          error={errors.endUserName}
        >
          <input
            id="wb-endUserName"
            className={INPUT}
            value={values.endUserName ?? ""}
            disabled={disabled}
            onChange={(e) => set("endUserName", e.target.value)}
          />
        </Field>
        <Field label={fieldLabel("end_user_surname")} htmlFor="wb-endUserSurname" error={errors.endUserSurname}>
          <input
            id="wb-endUserSurname"
            className={INPUT}
            value={values.endUserSurname ?? ""}
            disabled={disabled}
            onChange={(e) => set("endUserSurname", e.target.value)}
          />
        </Field>
        <Field label={fieldLabel("aka")} htmlFor="wb-aka" help="A nickname the caller might be given.">
          <input
            id="wb-aka"
            className={INPUT}
            value={values.aka ?? ""}
            disabled={disabled}
            onChange={(e) => set("aka", e.target.value)}
          />
        </Field>
        <Field
          label={fieldLabel("phone")}
          htmlFor="wb-phone"
          required
          error={errors.phone}
          help="Any format. 08012345678, +234 801 234 5678 and 8012345678 all work."
        >
          <input
            id="wb-phone"
            type="tel"
            className={INPUT}
            value={values.phone ?? ""}
            disabled={disabled}
            onChange={(e) => set("phone", e.target.value)}
          />
        </Field>
        <Field label={fieldLabel("other_phone")} htmlFor="wb-otherPhone" error={errors.otherPhone}>
          <input
            id="wb-otherPhone"
            type="tel"
            className={INPUT}
            value={values.otherPhone ?? ""}
            disabled={disabled}
            onChange={(e) => set("otherPhone", e.target.value)}
          />
        </Field>
        <Field
          label={fieldLabel("contact_person")}
          htmlFor="wb-contactPerson"
          help="Only if somebody else is the point of contact."
        >
          <input
            id="wb-contactPerson"
            className={INPUT}
            value={values.contactPerson ?? ""}
            disabled={disabled}
            onChange={(e) => set("contactPerson", e.target.value)}
          />
        </Field>
        <Field label={fieldLabel("contact_phone")} htmlFor="wb-contactPhone" error={errors.contactPhone}>
          <input
            id="wb-contactPhone"
            type="tel"
            className={INPUT}
            value={values.contactPhone ?? ""}
            disabled={disabled}
            onChange={(e) => set("contactPhone", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Where they live">
        {/*
          Chosen, not typed.

          These were two free-text inputs, on the screen a typist uses forty
          times a morning with a paper receipt in hand - so this was the one
          place in the app where a misspelt state could enter the database with
          nothing to be wrong against. The 36 states, the FCT and all 774 LGAs
          were already in this database and already served by the geo-data
          function; the bench simply never asked for them.
        */}
        <div className="sm:col-span-2 lg:col-span-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div
            id="wb-stateBackup"
            tabIndex={-1}
            className={`scroll-mt-24 rounded-md ${
              errors.stateBackup || errors.lgaBackup ? "ring-2 ring-red-300 ring-offset-1" : ""
            }`}
          >
            <StateLgaSelect
              idPrefix="wb"
              state={values.stateBackup ?? ""}
              lga={values.lgaBackup ?? ""}
              disabled={disabled}
              onState={(v) => {
                set("stateBackup", v);
                setAddress("state", v);
              }}
              onLga={(v) => set("lgaBackup", v)}
            />
          </div>
        </div>
        {(errors.stateBackup || errors.lgaBackup) && (
          <p className="sm:col-span-2 lg:col-span-3 text-xs text-red-600">
            {errors.stateBackup ?? errors.lgaBackup}
          </p>
        )}
        <Field
          label={fieldLabel("full_address")}
          htmlFor="wb-address"
          required
          wide
          error={errors.addressData || errors.fullAddress}
          help="Enough detail for a field agent to find the house. Coordinates are optional and are left empty when the address was typed rather than picked from a map."
        >
          <input
            id="wb-address"
            className={INPUT}
            value={values.addressData?.fullAddress ?? ""}
            disabled={disabled}
            onChange={(e) => setAddress("fullAddress", e.target.value)}
          />
        </Field>
        <Field label={fieldLabel("city")} htmlFor="wb-city" help="The town or village on the agreement. The LGA is its own field above.">
          <input
            id="wb-city"
            className={INPUT}
            value={values.addressData?.city ?? ""}
            disabled={disabled}
            onChange={(e) => setAddress("city", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="The purchase">
        <Field
          label={fieldLabel("sales_agent_name")}
          htmlFor="wb-salesAgentName"
          help="Prefilled from the transfer's sales rep; change it if the agreement says otherwise."
        >
          <input
            id="wb-salesAgentName"
            className={INPUT}
            value={values.salesAgentName ?? ""}
            disabled={disabled}
            onChange={(e) => set("salesAgentName", e.target.value)}
          />
        </Field>
        <Field label={fieldLabel("sales_date")} htmlFor="wb-salesDate" required error={errors.salesDate}>
          <input
            id="wb-salesDate"
            type="date"
            className={INPUT}
            value={values.salesDate ?? ""}
            disabled={disabled}
            onChange={(e) => set("salesDate", e.target.value)}
          />
        </Field>
        <Field
          label={fieldLabel("payment_model_id")}
          htmlFor="wb-salesModel"
          error={errors.salesModel}
          help={
            models.length === 0
              ? "No active sales models exist to offer. They are set up under Settings, Payment models."
              : modelsRestricted
              ? "The models this partner is assigned. Needed unless the buyer paid in full."
              : "This partner has no models assigned, so every model is offered. Pick the one on the receipt."
          }
        >
          <select
            id="wb-salesModel"
            className={INPUT}
            value={values.salesModel ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const name = e.target.value;
              set("salesModel", name);
              // The model's price fills an EMPTY amount. A typed amount is never
              // overwritten: the receipt wins.
              const picked = models.find((m) => m.name === name);
              const price = picked?.price ? Number(picked.price) : 0;
              if (price > 0 && !String(values.amount ?? "").trim()) set("amount", String(price));
            }}
          >
            <option value="">{models.length ? "Pick the model on the receipt" : "None available"}</option>
            {models.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
                {m.price && Number(m.price) > 0
                  ? ` (\u20a6${Number(m.price).toLocaleString("en-NG")})`
                  : ""}
              </option>
            ))}
          </select>
          {orderModel?.name ? (
            <p className="mt-1 text-xs text-gray-600">
              Sent with transfer {transactionId ?? "this consignment"} as <span className="font-medium">{orderModel.name}</span>
              {orderModel.durationMonths ? ` (${orderModel.durationMonths} months)` : ""}.
              {models.some((m) => m.name === orderModel.name) ? "" : " This partner is not offered that model, so pick the one on the receipt."}
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">No sales model was sent with this transfer.</p>
          )}
        </Field>
        <Field
          label={fieldLabel("amount")}
          htmlFor="wb-amount"
          required
          error={errors.amount}
          help="Digits only. No naira sign, no commas."
        >
          <input
            id="wb-amount"
            type="number"
            className={INPUT}
            value={values.amount ?? ""}
            disabled={disabled}
            onChange={(e) => set("amount", e.target.value)}
          />
        </Field>
        <Field
          label={fieldLabel("first_payment")}
          htmlFor="wb-amountReceived"
          error={errors.amountReceived}
          help="Leave empty if nothing has been paid, rather than typing 0."
        >
          <input
            id="wb-amountReceived"
            type="number"
            className={INPUT}
            value={values.amountReceived ?? ""}
            disabled={disabled}
            onChange={(e) => set("amountReceived", e.target.value)}
          />
        </Field>
        <Field
          label={fieldLabel("retailer_branch")}
          htmlFor="wb-retailerBranch"
          help="Filled in from the partner. Change it only if the receipt says otherwise."
        >
          <input
            id="wb-retailerBranch"
            className={INPUT}
            value={values.retailerBranch ?? ""}
            disabled={disabled}
            onChange={(e) => set("retailerBranch", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Stove set">
        <Field label={fieldLabel("pot_quantity")} htmlFor="wb-potQuantity">
          <SearchableSelect
            id="wb-potQuantity"
            ariaLabel={fieldLabel("pot_quantity")}
            value={String(values.potQuantity ?? "")}
            disabled={disabled}
            onChange={(next) => set("potQuantity", next)}
            placeholder="Select"
            options={potOptions}
          />
        </Field>
        <Field label={fieldLabel("heat_retention_device")} htmlFor="wb-heatRetentionDevice">
          <label className="flex items-center gap-2 py-1.5 text-sm text-gray-700">
            <input
              id="wb-heatRetentionDevice"
              type="checkbox"
              checked={values.heatRetentionDevice === true}
              disabled={disabled}
              onChange={(e) => set("heatRetentionDevice", e.target.checked)}
              className="h-4 w-4 accent-(--dc-accent)"
            />
            Included
          </label>
        </Field>
      </Section>

      <Section title="Cooking habits">
        <div className="sm:col-span-2 lg:col-span-3">
          <p className="mb-1 text-xs font-medium text-gray-700">{fieldLabel("previous_stove_type")}</p>
          <div className="flex flex-wrap gap-4">
            {PREVIOUS_STOVES.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="wb-previousStoveType"
                  value={o.value}
                  checked={values.previousStoveType === o.value}
                  disabled={disabled}
                  onChange={(e) => set("previousStoveType", e.target.value)}
                  className="h-4 w-4 accent-(--dc-accent)"
                />
                {o.label}
              </label>
            ))}
          </div>
          {values.previousStoveType === "other" && (
            <input
              className={`${INPUT} mt-2`}
              placeholder="Describe the stove type"
              value={values.previousStoveOther ?? ""}
              disabled={disabled}
              onChange={(e) => set("previousStoveOther", e.target.value)}
            />
          )}
        </div>
        <Field label={fieldLabel("meals_per_day")} htmlFor="wb-mealsPerDay">
          <input
            id="wb-mealsPerDay"
            className={INPUT}
            placeholder="e.g. 2 meals"
            value={values.mealsPerDay ?? ""}
            disabled={disabled}
            onChange={(e) => set("mealsPerDay", e.target.value)}
          />
        </Field>
        <Field label={fieldLabel("cooking_fuel_source")} htmlFor="wb-cookingFuelSource">
          <input
            id="wb-cookingFuelSource"
            className={INPUT}
            placeholder="e.g. Local market"
            value={values.cookingFuelSource ?? ""}
            disabled={disabled}
            onChange={(e) => set("cookingFuelSource", e.target.value)}
          />
        </Field>
        <Field label={fieldLabel("cooking_location")} htmlFor="wb-cookingLocation">
          <input
            id="wb-cookingLocation"
            className={INPUT}
            placeholder="e.g. Outdoors, kitchen"
            value={values.cookingLocation ?? ""}
            disabled={disabled}
            onChange={(e) => set("cookingLocation", e.target.value)}
          />
        </Field>
      </Section>

      <section
        id="wb-termsAccepted"
        tabIndex={-1}
        className={`scroll-mt-24 rounded-md ${errors.termsAccepted ? "ring-2 ring-red-300 ring-offset-1 p-2" : ""}`}
      >
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
          {fieldLabel("terms_accepted")}
        </h4>
        <p className="mb-2 text-xs text-gray-600">
          All six are on the paper agreement and all six are required. Tick what
          the buyer actually agreed to: this is copied onto the agreement
          document, so ticking them to get past this screen puts a false
          statement on a printed record.
        </p>
        <div className="space-y-1.5 rounded-lg border border-gray-200 p-3">
          {/* All six at once, because a signed paper agreement means the buyer
              agreed to all six and ticking them singly is six clicks to record
              one fact. It stays a deliberate act: the label says what is being
              asserted, and unticking one afterwards is how a genuinely partial
              agreement gets recorded. */}
          <label className="flex items-start gap-2 border-b border-gray-100 pb-2 text-sm font-medium text-gray-900">
            <input
              type="checkbox"
              checked={allTerms}
              disabled={disabled}
              onChange={(e) =>
                set(
                  "termsAccepted",
                  Object.fromEntries(TERMS.map((t) => [t.key, e.target.checked])),
                )
              }
              className="mt-0.5 h-4 w-4 shrink-0 accent-(--dc-accent)"
            />
            The buyer agreed to all six, as signed on the paper agreement
          </label>
          {TERMS.map((t) => (
            <label key={t.key} className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={terms[t.key] === true}
                disabled={disabled}
                onChange={(e) =>
                  set("termsAccepted", { ...terms, [t.key]: e.target.checked })
                }
                className="mt-0.5 h-4 w-4 shrink-0 accent-(--dc-accent)"
              />
              {t.label}
            </label>
          ))}
          {!allTerms && (
            <p className="flex items-start gap-1.5 pt-1 text-xs text-amber-700">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The sale cannot be finished until every one is ticked.
            </p>
          )}
        </div>
        {errors.termsAccepted && (
          <p className="mt-1 text-xs text-red-600">{errors.termsAccepted}</p>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
          Signature
        </h4>
        {/* The sales app's own canvas: draw, upload a photograph of the paper
            signature, or use the camera. Not reimplemented, so a signature
            captured here is the same object as one captured in Sell Stove and
            prints identically on the agreement.

            Optional at the bench, and said so in the label: the receipt on the
            desk already carries the customer's signature. See BENCH_OPTIONAL. */}
        <p className="mb-2 text-xs text-gray-500">
          The paper receipt carries the customer's signature, so this is optional here.
          Photograph it or draw it if the agreement printout should show one.
        </p>
        <SignatureCanvas
          signature={values.signature ?? ""}
          onSignatureChange={(sig) => set("signature", sig)}
          error={errors.signature}
          label={`${fieldLabel("signature")} (optional)`}
        />
      </section>

      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
          Photographs
        </h4>
        <p className="mb-2 text-xs text-gray-600">
          The stove and the signed paper agreement. Both are optional to save,
          and both are what somebody auditing this record will look for first.
        </p>
        {uploadError && (
          <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            {uploadError}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ImageUploadSection
            label={fieldLabel("stove_image_id")}
            preview={previews.stove}
            uploading={uploading.stove}
            onUpload={(file) => upload(file, "stove")}
            placeholder="A photograph of the stove with its serial number visible"
            uploadIcon={Camera}
            buttonText="Upload stove photo"
            enableCamera
          />
          <ImageUploadSection
            label={fieldLabel("agreement_image_id")}
            preview={previews.agreement}
            uploading={uploading.agreement}
            onUpload={(file) => upload(file, "agreement")}
            placeholder="A photograph or scan of the signed paper agreement"
            uploadIcon={FileText}
            buttonText="Upload agreement"
            enableCamera
          />
        </div>
        {(uploading.stove || uploading.agreement) && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-600">
            <Loader2 className="h-3 w-3 animate-spin" /> Uploading. The rest of the
            form stays as you left it.
          </p>
        )}
      </section>
    </div>
  );
}
