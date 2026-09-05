import SerialRematch from "../call-centre/SerialRematch";

/**
 * A disputed serial number never goes through `update-sale`: the sales app treats
 * the serial as immutable there. It moves through the module's own rematch,
 * which claims the right stove under a lock and releases the wrong one, and
 * whose door opens for the routed fixer while the episode names the serial.
 * Once moved, the note below sends the episode for review.
 */
export default function SerialFixPanel({ saleId, currentSerial, onChanged }) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-amber-500 bg-white shadow-sm">
      <header className="border-b border-gray-100 bg-amber-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">Fix the serial number</h2>
        <p className="mt-0.5 text-xs text-gray-600">
          The record carries <span className="font-mono">{currentSerial ?? "no serial number"}</span>. Move it onto the number on the plate; the module checks the stove is free and swaps the records.
        </p>
      </header>
      <div className="p-4">
        <SerialRematch saleId={saleId} currentSerial={currentSerial} canEdit onDone={onChanged} />
      </div>
    </section>
  );
}
