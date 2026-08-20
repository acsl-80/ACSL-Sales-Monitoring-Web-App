import { useEffect, useState } from "react";
import { dataCenterImport } from "../../lib/client";
import ImportPanel from "./ImportPanel";

/**
 * Loads the partner list, then hands it to the panel.
 *
 * Split from ImportPanel so the panel stays about importing rather than about
 * fetching. The list is scoped server-side: it holds only the partners this
 * caller may import for, because create-sale would refuse the others anyway
 * and offering a choice that will be refused is worse than not offering it.
 */
export default function ImportSection({ canUpload, canCommit, canResolve }) {
  const [organizations, setOrganizations] = useState([]);

  useEffect(() => {
    let alive = true;
    dataCenterImport
      .partners()
      .then((list) => {
        if (alive) setOrganizations(list);
      })
      .catch(() => {
        // The panel works without the list; the operator just cannot pick a
        // partner, and the panel says so when they try to upload.
        if (alive) setOrganizations([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ImportPanel
      canUpload={canUpload}
      canCommit={canCommit}
      canResolve={canResolve}
      organizations={organizations}
    />
  );
}
