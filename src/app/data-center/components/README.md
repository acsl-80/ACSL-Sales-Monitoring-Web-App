# components

Presentational only. A component never builds a query and never calls an edge
function directly; it takes props and renders.

The virtualized table lives here. At 500,000 rows the DOM is a bottleneck as
much as the query is.
