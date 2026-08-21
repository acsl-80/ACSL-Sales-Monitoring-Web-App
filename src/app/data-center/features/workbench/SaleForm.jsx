import { useMemo, useState } from "react";
import ImageUploadSection from "@/app/components/ui/ImageUploadSection";
import SignatureCanvas from "@/app/components/ui/SignatureCanvas";
import adminSalesService from "@/app/services/adminSalesService";
import { validateSalesForm } from "@/app/utils/salesFormValidation";
import { generateTransactionId } from "@/app/utils/salesFormUtils";
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

const PREVIOUS_STOVES = [
  { value: "charcoal", label: "Charcoal" },
  { value: "wood_stove", label: "Wood (3 stone)" },
  { value: "other", label: "Other" },
];

/** The shape Sell Stove starts from, so the two forms hold the same record. */
export function blankSale() {
  return {
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
 * What the sales app itself says is wrong with this record.
 *
 * Its validator, not a second opinion. A rule that disagreed would mean a
 * record accepted here and refused there, or worse the other way round.
 */
export function saleProblems(values) {
  return validateSalesForm(withDefaults(values)) ?? {};
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
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : ""}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-gray-700">
        {label}
        {required && (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
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

export default function SaleForm({ values, onChange, disabled, errors = {} }) {
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

  const potOptions = useMemo(() => ["0", "1", "2"], []);

  return (
    <div className="space-y-5">
      <Section title="Who bought it">
        <Field
          label="First name"
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
        <Field label="Surname" htmlFor="wb-endUserSurname" error={errors.endUserSurname}>
          <input
            id="wb-endUserSurname"
            className={INPUT}
            value={values.endUserSurname ?? ""}
            disabled={disabled}
            onChange={(e) => set("endUserSurname", e.target.value)}
          />
        </Field>
        <Field label="Also known as" htmlFor="wb-aka" help="A nickname the caller might be given.">
          <input
            id="wb-aka"
            className={INPUT}
            value={values.aka ?? ""}
            disabled={disabled}
            onChange={(e) => set("aka", e.target.value)}
          />
        </Field>
        <Field
          label="Telephone number"
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
        <Field label="Other telephone number" htmlFor="wb-otherPhone" error={errors.otherPhone}>
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
          label="Contact person"
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
        <Field label="Contact phone" htmlFor="wb-contactPhone" error={errors.contactPhone}>
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
        <Field label="State" htmlFor="wb-state" required error={errors.stateBackup}>
          <input
            id="wb-state"
            className={INPUT}
            value={values.stateBackup ?? ""}
            disabled={disabled}
            onChange={(e) => {
              set("stateBackup", e.target.value);
              setAddress("state", e.target.value);
            }}
          />
        </Field>
        <Field label="Local government area" htmlFor="wb-lga" required error={errors.lgaBackup}>
          <input
            id="wb-lga"
            className={INPUT}
            value={values.lgaBackup ?? ""}
            disabled={disabled}
            onChange={(e) => {
              set("lgaBackup", e.target.value);
              setAddress("city", e.target.value);
            }}
          />
        </Field>
        <Field
          label="Residential address"
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
      </Section>

      <Section title="The purchase">
        <Field label="Sales date" htmlFor="wb-salesDate" required error={errors.salesDate}>
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
          label="Sale amount"
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
          label="Amount paid"
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
          label="Retailer / sales branch"
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
        <Field label="Pots quantity" htmlFor="wb-potQuantity">
          <select
            id="wb-potQuantity"
            className={INPUT}
            value={String(values.potQuantity ?? "")}
            disabled={disabled}
            onChange={(e) => set("potQuantity", e.target.value)}
          >
            <option value="">Select</option>
            {potOptions.map((n) => (
              <option key={n} value={n}>
                {n} {n === "1" ? "pot" : "pots"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Wonderbox (heat retention)" htmlFor="wb-heatRetentionDevice">
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
          <p className="mb-1 text-xs font-medium text-gray-700">Previous stove type</p>
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
        <Field label="Meals per day" htmlFor="wb-mealsPerDay">
          <input
            id="wb-mealsPerDay"
            className={INPUT}
            placeholder="e.g. 2 meals"
            value={values.mealsPerDay ?? ""}
            disabled={disabled}
            onChange={(e) => set("mealsPerDay", e.target.value)}
          />
        </Field>
        <Field label="Fuel source" htmlFor="wb-cookingFuelSource">
          <input
            id="wb-cookingFuelSource"
            className={INPUT}
            placeholder="e.g. Local market"
            value={values.cookingFuelSource ?? ""}
            disabled={disabled}
            onChange={(e) => set("cookingFuelSource", e.target.value)}
          />
        </Field>
        <Field label="Cooking location" htmlFor="wb-cookingLocation">
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

      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
          Terms and conditions
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
            prints identically on the agreement. */}
        <SignatureCanvas
          signature={values.signature ?? ""}
          onSignatureChange={(sig) => set("signature", sig)}
          error={errors.signature}
          label="Customer signature"
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
            label="Stove photograph"
            preview={previews.stove}
            uploading={uploading.stove}
            onUpload={(file) => upload(file, "stove")}
            placeholder="A photograph of the stove with its serial visible"
            uploadIcon={Camera}
            buttonText="Upload stove photo"
            enableCamera
          />
          <ImageUploadSection
            label="Signed agreement"
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
