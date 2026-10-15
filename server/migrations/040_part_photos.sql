-- One photo per part so techs can see what they're looking for (uploads.js /parts/:id).
-- The phone shrinks it to ~640px before upload; the picture itself is an attachments row.
ALTER TABLE parts ADD COLUMN IF NOT EXISTS photo_url TEXT;
