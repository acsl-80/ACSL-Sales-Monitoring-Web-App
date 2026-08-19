-- Backfill sales_date, customer, downloaded_by, sales_rep in stove_transfer_history
-- using the raw CSV stored in sync_logs.request_summary->>'csv_data'.
--
-- Matches stove_transfer_history rows via transaction_id = sales_reference from the CSV.

DO $$
DECLARE
  log_row          RECORD;
  csv_text         TEXT;
  csv_lines        TEXT[];
  headers          TEXT[];
  data_line        TEXT;
  cols             TEXT[];
  sales_ref_idx    INT;
  sales_date_idx   INT;
  customer_idx     INT;
  downloaded_by_idx INT;
  sales_rep_idx    INT;
  raw_date         TEXT;
  parsed_date      DATE;
  sales_ref_val    TEXT;
  customer_val     TEXT;
  downloaded_by_val TEXT;
  sales_rep_val    TEXT;
BEGIN

  FOR log_row IN
    SELECT id, request_summary
    FROM   sync_logs
    WHERE  source = 'external-csv-sync'
      AND  status IN ('success', 'partial')
      AND  request_summary ? 'csv_data'
      AND  request_summary->>'csv_data' IS NOT NULL
  LOOP

    csv_text := log_row.request_summary->>'csv_data';

    csv_lines := array_remove(
      string_to_array(csv_text, E'\n'),
      ''
    );

    IF array_length(csv_lines, 1) < 2 THEN
      CONTINUE;
    END IF;

    -- Parse header — lowercase, strip quotes and CR
    headers := string_to_array(
      lower(replace(replace(csv_lines[1], '"', ''), E'\r', '')),
      ','
    );

    sales_ref_idx     := NULL;
    sales_date_idx    := NULL;
    customer_idx      := NULL;
    downloaded_by_idx := NULL;
    sales_rep_idx     := NULL;

    FOR i IN 1..array_length(headers, 1) LOOP
      CASE trim(headers[i])
        WHEN 'sales reference', 'sales_reference', 'salesreference' THEN sales_ref_idx     := i;
        WHEN 'sales date',      'sales_date',      'salesdate'      THEN sales_date_idx    := i;
        WHEN 'customer',        'customer_name',   'customer name'  THEN customer_idx      := i;
        WHEN 'downloaded by',   'downloaded_by',   'downloadedby'   THEN downloaded_by_idx := i;
        WHEN 'sales rep',       'sales_rep',       'salesrep',
             'sales representative', 'sales_representative'         THEN sales_rep_idx     := i;
        ELSE NULL;
      END CASE;
    END LOOP;

    -- Need at least sales_ref to do anything useful
    IF sales_ref_idx IS NULL THEN
      CONTINUE;
    END IF;

    FOR i IN 2..array_length(csv_lines, 1) LOOP
      data_line := replace(csv_lines[i], E'\r', '');
      cols      := string_to_array(replace(data_line, '"', ''), ',');

      CONTINUE WHEN array_length(cols, 1) IS NULL;

      sales_ref_val := CASE WHEN sales_ref_idx <= array_length(cols, 1)     THEN trim(cols[sales_ref_idx])     ELSE '' END;
      CONTINUE WHEN sales_ref_val = '';

      -- Parse date if available
      parsed_date := NULL;
      IF sales_date_idx IS NOT NULL AND sales_date_idx <= array_length(cols, 1) THEN
        raw_date := trim(cols[sales_date_idx]);
        IF raw_date <> '' THEN
          BEGIN
            parsed_date := to_date(raw_date, 'DD/MM/YYYY');
          EXCEPTION WHEN OTHERS THEN
            BEGIN
              parsed_date := raw_date::DATE;
            EXCEPTION WHEN OTHERS THEN
              parsed_date := NULL;
            END;
          END;
        END IF;
      END IF;

      customer_val      := CASE WHEN customer_idx      IS NOT NULL AND customer_idx      <= array_length(cols, 1) THEN nullif(trim(cols[customer_idx]),      '') ELSE NULL END;
      downloaded_by_val := CASE WHEN downloaded_by_idx IS NOT NULL AND downloaded_by_idx <= array_length(cols, 1) THEN nullif(trim(cols[downloaded_by_idx]), '') ELSE NULL END;
      sales_rep_val     := CASE WHEN sales_rep_idx     IS NOT NULL AND sales_rep_idx     <= array_length(cols, 1) THEN nullif(trim(cols[sales_rep_idx]),     '') ELSE NULL END;

      UPDATE stove_transfer_history
      SET
        sales_date    = COALESCE(sales_date,    parsed_date),
        customer      = COALESCE(customer,      customer_val),
        downloaded_by = COALESCE(downloaded_by, downloaded_by_val),
        sales_rep     = COALESCE(sales_rep,     sales_rep_val)
      WHERE transaction_id = sales_ref_val
        AND (
          sales_date    IS NULL OR
          customer      IS NULL OR
          downloaded_by IS NULL OR
          sales_rep     IS NULL
        );

    END LOOP;

  END LOOP;

  RAISE NOTICE 'Backfill complete.';
END;
$$;
