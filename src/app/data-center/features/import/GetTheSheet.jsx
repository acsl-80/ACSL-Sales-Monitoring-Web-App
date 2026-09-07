import { useEffect, useMemo, useState } from "react";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import DigitisationSheet from "../partner-records/DigitisationSheet";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  FileSpreadsheet, Download, PenLine, Upload, ArrowRight, Info, ChevronDown,
} from "lucide-react";

/**
 * Step one of a bulk import: get the sheet.
 *
 * WHAT WAS WRONG
 *
 * The Import page opened on "Choose a file", which assumes a file already
 * exists. It never said where that file comes from. The sheet it wants - one
 * row per transferred stove, stove ID and transfer reference already filled
 * in, dropdowns on the columns that have fixed answers - was already built and
 * downloadable, but only from inside Partner Records, three clicks away, on a
 * page somebody visiting Import has no reason to open.
 *
 * So the two halves of one job lived on two pages, and the page named after
 * the job held the second half only. People filled in blank spreadsheets of
 * their own and typed every stove ID by hand, which is the single error the
 * import cannot recover from: a mistyped serial does not look like a typo, it
 * looks like a stove that is not ours.
 *
 * THE ACTION IS OUT OF THE FOLD (import redesign, 2026-09-07)
 *
 * Picking a partner and building the sheet used to sit inside step one of a
 * folded explainer, so the thing most people came here to do was one click
 * behind a heading that read like documentation. The picker and the button
 * now sit on the card itself; the explainer still names all three steps,
 * including the one that happens outside the app, for whoever is doing this
 * for the first time.
 *
 * WHY YOU PICK A PARTNER HERE AND NOT ON UPLOAD
 *
 * Because the sheet is built FROM the partner's transfers - it cannot exist
 * without knowing whose stoves to list. Coming back the other way the stove
 * IDs already say which partner it is, which is why the upload asks nothing.
 * The asymmetry is deliberate and is stated on both sides.
 */

function Step({ n, title, children, tone = "plain" }) {
  return (
    <li
      className={`relative flex gap-3 rounded-xl border p-4 ${
        tone === "active"
          ? "border-(--dc-accent)/40 bg-(--dc-accent-soft)/40"
          : "border-gray-200 bg-white"
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          tone === "active"
            ? "bg-(--dc-accent) text-white"
            : "bg-gray-100 text-gray-600"
        }`}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <div className="mt-1 text-sm text-gray-700">{children}</div>
      </div>
    </li>
  );
}

export default function GetTheSheet({ onGoToUpload }) {
  const [partners, setPartners] = useState(null);
  const [chosen, setChosen] = useState("");
  /**
   * Folded by default.
   *
   * The explainer is the story, not the action: somebody who has built sheets
   * before does not need three panels of instructions between them and the
   * picker, and somebody who has not can open it in one click.
   */
  const [showHow, setShowHow] = useState(false);
  const [error, setError] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let live = true;
    dataCenterImport
      .partners()
      .then((rows) => live && setPartners(rows))
      .catch((err) => {
        if (!live) return;
        setPartners([]);
        setError(
          err instanceof DataCenterError
            ? err.message
            : "Could not load the partner list.",
        );
      });
    return () => {
      live = false;
    };
  }, []);

  const partnerName = useMemo(
    () =>
      chosen === "all"
        ? "every partner you cover"
        : ((partners ?? []).find((p) => p.id === chosen)?.partner_name ?? ""),
    [partners, chosen],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 bg-(--dc-accent-soft)/30 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Get a sheet for a partner</p>
          <p className="text-xs text-gray-600">
            one row per stove they were sent, serials already in
          </p>
        </div>
        {/*
          Folded away once somebody is past it.

          Read on the way in, the three steps are help. Read by somebody whose
          file is already staged and waiting on a decision, they are three
          panels of instructions for work already finished. It stays one click
          away, because the person doing this next month has not done it
          before.
        */}
        <button
          type="button"
          onClick={() => setShowHow((v) => !v)}
          aria-expanded={showHow}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-(--dc-accent)/30 bg-white px-2.5 py-1.5 text-xs font-medium text-(--dc-accent-strong) transition hover:bg-(--dc-accent-soft)/60"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          How a bulk import works
          <ChevronDown
            className={`h-3.5 w-3.5 transition ${showHow ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="border-b border-gray-100 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            {/*
              Explicitly associated, for the same reason as the records filter
              panel: wrapping folds every <option> into the accessible name, so
              a partner called "... Partner" would make this control answer to
              "Partner" - which the import spec asserts nothing on this page
              does, precisely because the upload asks no such question.
            */}
            <label
              htmlFor="dc-sheet-partner"
              className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600"
            >
              Whose stoves
            </label>
            {/*
              Typed into, not scrolled.

              This was a native select over 422 organizations, which answers a
              keystroke by jumping to the first name starting with that letter
              and then forgetting it. Finding one partner meant scrolling a
              list four hundred long while knowing its name the whole time.

              "Every partner you cover" stays pinned above the matches rather
              than being something you can type your way past: it is not a
              partner, it is the other kind of answer to the question.
            */}
            <SearchableSelect
              id="dc-sheet-partner"
              ariaLabel="Whose stoves"
              value={chosen}
              onChange={setChosen}
              disabled={partners === null}
              placeholder={partners === null ? "Loading partners..." : "Choose a partner"}
              searchPlaceholder="Type part of the partner's name"
              emptyLabel="No partner you cover matches that"
              pinned={
                partners !== null && partners.length > 1
                  ? { value: "all", label: "Every partner you cover" }
                  : null
              }
              options={(partners ?? []).map((p) => ({
                value: p.id,
                label: p.partner_name,
                hint: p.state ?? null,
              }))}
            />
          </div>

          <button
            type="button"
            disabled={!chosen}
            onClick={() => setSheetOpen(true)}
            className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-md bg-(image:--dc-fig-transferred) px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40 sm:w-auto"
          >
            <Download className="h-4 w-4" /> Build the sheet
          </button>
        </div>

        {partners !== null && partners.length === 0 && (
          <p className="mt-2 text-xs text-gray-600">
            {/* Two different facts. A partner user has one partner and it
                should be here; an empty list means something is wrong with
                the grant, not with the partner. */}
            {error ?? "No partners are available to you."}
          </p>
        )}

        <p className="mt-2 text-xs text-gray-600">
          Excel with the dropdowns, or CSV. Fill it in away from the app;
          several people can share one file.
        </p>
      </div>

      {showHow && (
        <>
          <ol className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-3">
            <Step n={1} title="Download the sheet for a partner" tone="active">
              <p>
                One row per stove that partner was sent. The stove ID and the
                transfer reference are already in it, so nobody types a
                serial. The columns with fixed answers are dropdowns.
              </p>
            </Step>

            <Step n={2} title="Fill it in, away from the app">
              <p>
                Type the buyer beside each stove: name, phone, address, what they
                paid. As many rows as you have receipts - that is the whole point
                of this path.
              </p>
              <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {/* The one thing a spreadsheet gets wrong on its own, said before
                    it happens rather than in a rejection afterwards. */}
                Leave the stove ID and transfer columns exactly as they came. Rows
                you do not fill in are simply skipped.
              </p>
              <p className="mt-2 text-xs text-gray-600">
                The sheet can go by email, live on a shared drive, or be filled in
                by several people. Nothing here is holding a lock on it.
              </p>
            </Step>

            <Step n={3} title="Upload it back">
              <p>
                Every row is checked before anything is written. You will see what
                matched, what needs a person, and what a commit would do - and
                nothing reaches the sales app until you say so.
              </p>
              <p className="mt-2 text-xs text-gray-600">
                You are not asked which partner it is. The stove IDs already say.
              </p>
              <button
                type="button"
                onClick={onGoToUpload}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/40 px-3 py-1.5 text-sm font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
              >
                <Upload className="h-4 w-4" /> Go to the upload
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </Step>
          </ol>

          <p className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 bg-gray-50/70 px-4 py-2.5 text-xs text-gray-600">
            <PenLine className="h-3.5 w-3.5 shrink-0 text-gray-500" />
            One receipt on its own does not need a sheet - use the digitalisation
            workbench, which walks a partner&apos;s stoves one at a time. It goes
            through exactly the same checks as a file.
          </p>
        </>
      )}

      {sheetOpen && chosen && (
        <DigitisationSheet
          // "" is the server's word for everything.
          organizationId={chosen === "all" ? "" : chosen}
          partnerName={partnerName || "this partner"}
          area="import"
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
