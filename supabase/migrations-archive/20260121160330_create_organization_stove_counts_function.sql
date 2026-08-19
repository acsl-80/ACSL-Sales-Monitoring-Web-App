-- Function to efficiently count stove IDs by organization
-- This replaces the inefficient method of fetching all stove_ids and counting them in the application

CREATE OR REPLACE FUNCTION get_organization_stove_counts(org_ids UUID[])
RETURNS TABLE (
  organization_id UUID,
  total_count BIGINT,
  sold_count BIGINT,
  available_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.organization_id,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE s.status = 'sold') as sold_count,
    COUNT(*) FILTER (WHERE s.status = 'available') as available_count
  FROM stove_ids s
  WHERE s.organization_id = ANY(org_ids)
  GROUP BY s.organization_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_organization_stove_counts TO authenticated;
GRANT EXECUTE ON FUNCTION get_organization_stove_counts TO service_role;

-- Add comment
COMMENT ON FUNCTION get_organization_stove_counts IS 'Efficiently counts total, sold, and available stove IDs for multiple organizations';
