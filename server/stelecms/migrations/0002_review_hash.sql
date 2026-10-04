-- Vier-Augen-Freigabe: Status-Hash des Entwurfs beim Einreichen (SPEC §3 „Veröffentlichen und Freigabe“).
-- Veröffentlichen einer eingereichten Präsentation mit abweichendem Hash → 409 changed_since_review.
ALTER TABLE presentations ADD COLUMN review_hash TEXT;
