# registry

The client side of the field registry that replaces the workbook's Key tab.

Question wording, option lists and field ordering are data, held in `field_defs`
and `option_values`. Adding, renaming or retiring a question is data entry, not
a release.

Survey answers live in `call_records.answers` jsonb and are rendered from here.
A field graduates to a real column when it starts being aggregated.
