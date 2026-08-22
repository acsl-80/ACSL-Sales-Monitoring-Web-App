/**
 * The lists the Stove Records filter panel offers.
 *
 * Fetched once per mount and held. Every list comes from a small table
 * server-side - partners and reps from the precomputed transfer funnel, states
 * and LGAs from reference data, models and agents from their own tables - so
 * this is one cheap request rather than a DISTINCT over half a million sales.
 *
 * A failure here is not an error the user needs to see. The panel still works
 * with its typed fields and its date range; it just cannot offer the lists, and
 * saying "could not load filter options" above a filter panel that visibly
 * works is noise. The error is returned for a caller that wants it and ignored
 * by the one that does not.
 */
import { useEffect, useState } from "react";
import { dataCenterClient, DataCenterError, type RecordFacets } from "./client";

const EMPTY: RecordFacets = {
  partners: [],
  salesReps: [],
  states: [],
  lgasByState: {},
  salesModels: [],
  salesAgents: [],
  scope: "",
};

export function useRecordFacets(): {
  facets: RecordFacets;
  loading: boolean;
  error: string | null;
} {
  const [facets, setFacets] = useState<RecordFacets>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    dataCenterClient
      .recordFacets()
      .then((f) => {
        if (!live) return;
        setFacets(f);
        setError(null);
      })
      .catch((err) => {
        if (!live) return;
        setError(
          err instanceof DataCenterError ? err.message : "Could not load the filter lists.",
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  return { facets, loading, error };
}
