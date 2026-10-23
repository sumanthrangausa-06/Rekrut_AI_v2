# Errata — migration 282 header (issue #1667, item 2)

The header comment of `migrations/282_curation_content_integrity.js` (lines 15–16)
says databases "where the loose 280 already ran (dev, staging) keep the poisoned
approvals".

**Correction:** migration 280 had **not** run on staging at the time 282 was
written. The parenthetical should read "(dev)" only.

Migration 282 itself is functionally correct in both worlds — on a database
where loose 280 never ran there is simply nothing for it to demote — so this is
a documentation erratum only. The migration file is deliberately **not** edited:
it has run on shared databases, and editing a run migration's comments is not
worth the checksum/drift risk. This note is the correction of record.
