-- Which age bands a per-guest option counts is the hotel's rule, not ours.
-- A day pass may count everyone who walks in; a tasting may count adults only;
-- a tour may count adults and children but not infants. Hard-coding
-- "adults + children" made one of those correct and the rest wrong.
ALTER TABLE plan_options ADD COLUMN counts_adults INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plan_options ADD COLUMN counts_children INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plan_options ADD COLUMN counts_infants INTEGER NOT NULL DEFAULT 0;
