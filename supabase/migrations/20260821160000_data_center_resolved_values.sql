-- ===========================================================================
-- What the call centre corrected IS the record.
--
-- The agent has the buyer on the phone. When they type a name, an address, a
-- state or an LGA, that is the true value and the digitalised one is what
-- somebody read off a receipt. Until now both sat side by side and every
-- consumer decided for itself which to believe - so the queue showed one, an
-- export showed the other, and a call agent rang a name nobody uses.
--
-- One definition, in the view, so there is nothing left to decide:
--
--     the correction where there is one, the digitalised value where there is not
--
-- The originals stay exposed under their own names. A surface that wants to
-- show "as digitalised, now corrected to" needs both, and losing the original
-- would make a correction unreviewable.
--
-- Phone already worked this way in one query and not in the view, which is how
-- the inconsistency started.
-- ===========================================================================

create or replace view data_center.v_call_center_resolved as
select v.*,

       -- A correction is only a correction when somebody typed something.
       -- nullif on the trimmed value: an agent who tabbed through a field and
       -- left a space has not corrected anything.
       coalesce(nullif(btrim(v.corrected_end_user_name), ''), v.end_user_name)
         as resolved_end_user_name,
       coalesce(nullif(btrim(v.corrected_phone), ''), v.primary_phone)
         as resolved_phone,
       coalesce(nullif(btrim(v.corrected_alt_phone), ''), v.alternative_phone)
         as resolved_alt_phone,
       coalesce(nullif(btrim(v.corrected_address), ''), v.user_residential_address)
         as resolved_address,
       coalesce(nullif(btrim(v.corrected_state), ''), v.user_state)
         as resolved_state,
       coalesce(nullif(btrim(v.corrected_lga), ''), v.user_lga)
         as resolved_lga,

       -- Whether anything was corrected at all, so a surface can mark the
       -- record without comparing six pairs of strings itself.
       (nullif(btrim(v.corrected_end_user_name), '') is not null
        or nullif(btrim(v.corrected_phone), '') is not null
        or nullif(btrim(v.corrected_alt_phone), '') is not null
        or nullif(btrim(v.corrected_address), '') is not null
        or nullif(btrim(v.corrected_state), '') is not null
        or nullif(btrim(v.corrected_lga), '') is not null) as was_corrected

  from data_center.v_call_center v;

comment on view data_center.v_call_center_resolved is
  'v_call_center with the call centre''s corrections applied. The corrected value where one was typed, the digitalised value where none was. Both remain available: a correction nobody can compare against the original is a correction nobody can review.';
