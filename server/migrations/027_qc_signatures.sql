-- Every sign-off on a department QC checklist (see src/qcSignatures.js). Before this,
-- each new signature replaced the last one, so a checklist only showed whoever signed
-- most recently.
ALTER TABLE qc_records ADD COLUMN IF NOT EXISTS qc_signatures JSONB NOT NULL DEFAULT '[]';

-- Bring back the earlier signatures from the activity log, which kept a full copy of
-- the record after every save. Each distinct signature becomes one entry, credited with
-- the items its signer had checked at the time. Only fills records that have no list
-- yet, so running the migrations again changes nothing.
WITH signed AS (
  SELECT q.id AS record_id, a.after_data AS row, a.created_at AS logged_at
  FROM qc_records q
  JOIN activity_log a ON a.resource = 'qc' AND a.record_id = q.id
  WHERE q.qc_signatures = '[]' AND q.qc_department IS NOT NULL
    AND coalesce(a.after_data->>'qc_signature_data', '') <> ''
  UNION ALL
  SELECT q.id, to_jsonb(q), q.updated_at
  FROM qc_records q
  WHERE q.qc_signatures = '[]' AND q.qc_department IS NOT NULL
    AND coalesce(q.qc_signature_data, '') <> ''
),
-- The first saved copy of each signature (later saves carry the same one along).
firsts AS (
  SELECT DISTINCT ON (record_id, row->>'qc_signature_data') record_id, row, logged_at
  FROM signed
  ORDER BY record_id, row->>'qc_signature_data', logged_at
),
-- One entry per person: their latest signature.
latest AS (
  SELECT DISTINCT ON (record_id, coalesce(row->>'qc_performed_by', '')) record_id, row
  FROM firsts
  ORDER BY record_id, coalesce(row->>'qc_performed_by', ''), coalesce((row->>'qc_signed_at')::timestamptz, logged_at) DESC
),
entries AS (
  SELECT l.record_id,
         (l.row->>'qc_signed_at')::timestamptz AS at,
         jsonb_build_object(
           'by', coalesce(l.row->>'qc_performed_by', ''),
           'userId', NULL,
           'at', to_char((l.row->>'qc_signed_at')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'signature', l.row->>'qc_signature_data',
           'items', coalesce((
             SELECT jsonb_agg(i.key ORDER BY i.key)
             FROM jsonb_each(coalesce(l.row->'qc_checklist'->'items', '{}'::jsonb)) i
             WHERE jsonb_typeof(i.value) = 'object'
               AND (i.value->>'done')::boolean IS TRUE
               AND i.value->>'by' = l.row->>'qc_performed_by'
           ), '[]'::jsonb),
           'status', l.row->>'qc_final_status',
           'rework', coalesce(l.row->>'qc_rework_needed', '') = 'Yes'
         ) AS entry
  FROM latest l
)
UPDATE qc_records q
SET qc_signatures = sub.list
FROM (SELECT record_id, jsonb_agg(entry ORDER BY at NULLS FIRST) AS list FROM entries GROUP BY record_id) sub
WHERE q.id = sub.record_id AND q.qc_signatures = '[]';
