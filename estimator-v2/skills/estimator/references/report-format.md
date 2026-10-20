# Readable component specification

The primary family report is the developer's reading entry point. Keep the same section order for every family:

1. Summary: explain the component and the content/children it owns in ordinary language.
2. Proposed structure and fields: Component, Field, Plain-language type, Purpose. Include direct-child component fields and links to their definitions. Describe an action as a logical label/destination group; this does not force a CMS type.
3. Observed content: per occurrence/viewport values and child counts/order. A full-page screenshot is not proof of all children being visible. Counts are observed instances, not editor limits. Long text may have an explicitly shortened preview here; full exact values remain in the JSON/appendix.
4. Appearance and typography: small tables identifying the actual root/field and captured viewport. Use readable labels for font family, size, weight, line height, color, layout, gaps, padding, radius, media fit and other saved measurements. Do not infer unsampled properties or use another element's styles.
5. Behaviour and accessibility: distinguish saved attributes/destinations from exercised interactions. This runtime does not probe interactions; list them as unverified. Preserve alt attributes without assuming empty alt proves editorial intent.
6. Gaps: missing samples, unresolved boundaries/owners, capture/interaction coverage and CMS decisions. Never repeat source-specific decisions as global rules.
7. Supporting evidence: link the family evidence appendix, relevant JSON records and actual raw/annotated captures and style records. Paths must resolve from the generated report. Keep exact selectors and full CSS/property values in the appendix/JSON.

The appendix retains the complete detailed element ledger. The primary report must not dump JSON objects into table cells, generate schema/code snippets, equate a DOM element with a CMS field, invent required/localized/shared-content settings or claim tested behaviour from attributes alone.

Use descriptive numbered filenames: C01-hero.md, C02-team-card.md and matching C01-hero.evidence.md appendices. The overview, child links, JSON paths and appendix backlinks must use those recorded filenames. Hashed family IDs are internal machine references, not user-facing filenames.

Readable labels are deterministic proposals (Heading, Body, Action, Image, etc.). Destination developers may refine names such as person name/job role only when evidence supports that interpretation. Do not hard-code every website to a Team/Card/Slider catalogue. Plain-language names and purposes accompany stable machine field names in discovery.json.

Developer reading order: export/report.md -> export/quality.json -> assigned component report -> linked child reports -> evidence appendix/JSON when exact implementation values or unresolved questions require them. The orchestrator must supply the exact run folder or accessible artifact references; this skill does not notify another agent automatically.
