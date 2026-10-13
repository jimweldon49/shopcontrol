-- Only real 5-digit ROs can need a supplement (ShopModel.jobKind in client/shared.js).
-- Opportunities imported from CCC with a SUPP_NO were flagged and filled the dashboard's
-- Supplements Needed box. Safe to re-run: real ROs are never touched.
UPDATE daily_go_list
SET supplement_needed = 'No',
    supplement_submitted = 'No',
    hold_up_reason = CASE WHEN hold_up_reason = 'Supplement' THEN 'None' ELSE hold_up_reason END,
    updated_at = now(),
    updated_by = 'Cleanup: opportunities have no supplements'
WHERE supplement_needed = 'Yes'
  AND btrim(coalesce(ro_number, '')) !~ '^\d{5}$';
