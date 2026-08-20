import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import DataCentreShell from "../components/DataCentreShell";
import RecordsTable from "../features/records/RecordsTable";
import { DATA_CENTER_FEATURES } from "../lib/features";

/**
 * How a drill param reads once it has narrowed the table. The wording says
 * which question was asked, because "Gombe" alone leaves the reader guessing
 * whether that is a partner, a state, or a rep.
 */
const SUBJECT = {
  organizationId: (v, label) => label ?? "one partner",
  userState: (v, label) => `buyers in ${label ?? v}`,
  saleStatus: (v, label) => `${label ?? v} by the sales app's own status`,
};

function Inner() {
  const search = useSearch({ from: "/data-center/stove-records" });
  const navigate = useNavigate();

  const drill = useMemo(() => {
    const filters = {};
    for (const key of ["organizationId", "userState", "saleStatus", "dateFrom", "dateTo"]) {
      if (search[key]) filters[key] = search[key];
    }
    if (Object.keys(filters).length === 0) return null;

    const parts = [];
    for (const [key, describe] of Object.entries(SUBJECT)) {
      if (filters[key]) parts.push(describe(filters[key], search.label));
    }
    if (filters.dateFrom || filters.dateTo) {
      parts.push(search.label ?? "a date range");
    }

    return {
      filters,
      description: parts.join(", ") || (search.label ?? "a dashboard figure"),
      clear: () => navigate({ to: "/data-center/stove-records", search: {} }),
    };
  }, [search, navigate]);

  return <RecordsTable drill={drill} />;
}

export default function StoveRecordsPage() {
  return (
    <DataCentreShell
      title="Stove Records"
      description="Every sold stove with the detail captured at the point of sale."
      breadcrumb="Stove Records"
      area="stove-records"
      feature={DATA_CENTER_FEATURES.RECORDS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}
