import { useSearch } from "@tanstack/react-router";
import DataCentreShell from "../components/DataCentreShell";
import StockList from "../features/analysis/StockList";
import { DATA_CENTER_FEATURES } from "../lib/features";

/**
 * Gated on records.view rather than analysis.view.
 *
 * This is a list of stock, which is the same class of fact as Partner Records,
 * and somebody chasing a consignment needs it whether or not they are allowed
 * to read the analysis that sent them here. The narrower key guards the
 * findings, not the inventory.
 */
export default function StockPage() {
  const search = useSearch({ from: "/data-center/stock" });
  return (
    <DataCentreShell
      title="Stock at partners"
      description="Transferred and not yet sold. The stoves behind the ageing chart."
      breadcrumb="Stock"
      area="analysis"
      feature={DATA_CENTER_FEATURES.RECORDS_VIEW}
    >
      <StockList
        organizationId={search.organizationId}
        ageBucket={search.ageBucket}
        state={search.state}
        label={search.label}
      />
    </DataCentreShell>
  );
}
