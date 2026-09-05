/**
 * The fields of a sale a correction may dispute, and how each is edited.
 *
 * This file is now a thin re-export. The one source is
 * `sale-dictionary.json`, read by `sale-dictionary.ts`, which derives the
 * shape this module used to hold by hand: the correctable fields plus the
 * stove ID and the two images, each with the `update-sale` payload key it is
 * written through. Keeping the module name and its exports means every
 * importer carries on unchanged while the words come from one place.
 *
 * `payload` is the key `update-sale` reads. `null` means the field is not
 * edited through `update-sale` at all: the stove ID goes through the module's
 * own `serial_rematch`, and the two images through the sales app's uploads.
 *
 * The client mirror is `src/app/data-center/features/corrections/lib/saleFields.js`,
 * and it reads the same JSON, so the two no longer drift.
 */

export type { SaleField, SaleFieldGroup } from "./sale-dictionary.ts";
export { SALE_FIELDS, knownSaleFields } from "./sale-dictionary.ts";
