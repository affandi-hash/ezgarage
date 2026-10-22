-- 187: package lists say "Labour", not "Labour (upah)"
UPDATE os_packages SET includes = array_replace(includes, 'Labour (upah)', 'Labour') WHERE 'Labour (upah)' = ANY (includes);
