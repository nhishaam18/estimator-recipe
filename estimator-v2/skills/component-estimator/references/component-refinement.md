# Component boundary refinement

The model marks visible Section and Inner occurrences. Scripts compare those results with saved DOM rectangles and measured structure. One implementation family may occur many times and on many pages. The build list counts that family once.

Section (level 1) owns the outer composition. Independently implemented child cards, slider items, navigation groups, forms and reusable CTA units are Inner (level 2). Owned text, icon, portrait, media, caption and ordinary link fields do not become separate build-list rows. A card-owned CTA stays associated with that card. An image-only missing asset does not erase an otherwise identifiable card.

Equivalent names at the same level may merge when purpose, fields and structure agree. Similar wording alone is insufficient. Never merge a parent with a child, an ordinary link with a CTA, or a composite card with its individual fields. Uncertain boundaries remain separate and are flagged. Page annotations retain every validated occurrence; export/build-list.json is the single canonical unique inventory.
