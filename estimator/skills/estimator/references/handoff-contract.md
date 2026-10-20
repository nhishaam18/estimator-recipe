# Platform-neutral developer handoff

Report page → section → actual child implementation units → owned elements. Do not limit the taxonomy to illustrative Team, Slider or Hero examples. Follow source structure and evidence.

## Required evidence

- Family ID and grouping basis; unique occurrence ID, route, viewport, source detection, parent and screenshot reference.
- Meaningful element ID and owner: headings, supporting content, media/icons, individual actions/links, controls, lists and formatting. Preserve exact saved DOM text and observed attributes separately from candidate semantic field names. Visible/legible status is not proved by DOM presence.
- Measurements: selector, document-pixel box when available, style sample ID, computed typography/layout/appearance, variables, pseudo-elements and media sizing/cropping. Missing samples stay null/explicit; do not fill from a neighboring element or guessed design system.
- Fonts: declared family/weight/style, loading status, observed URL references and unavailable evidence. Actual per-glyph font, binaries and rights remain unverified.
- Responsive observations: compare actual captured widths and occurrence values. Do not infer unmeasured breakpoints or hidden states. Similar structural matches on uncaptured pages remain inferred.
- Actions: record declared destinations/attributes as source facts. A hyperlink does not prove successful navigation; event-only actions and slider behavior remain unknown until separately tested.
- Coverage limits: bounded style samples, omitted iframe/shadow/canvas contents, missing selectors/assets/screenshots, blocked pages, propagated labels and ambiguous classifications.

## Destination developer responsibilities

Every component family report includes a readable summary, structure/field table, observed content, measured typography/appearance, behaviour/accessibility, gaps and supporting evidence. Follow [the report format](report-format.md). Its complete DOM ledger lives in the linked evidence appendix. Neutral proposals describe text, formatted content, image evidence, link/action values, controls, presentation-only responsibilities and ordered child collections. Child collections link the actual child definitions and occurrence IDs; counts describe observed instances and are not editor min/max constraints. Scalar proposals reference the exact owned element evidence and measured styles/assets. Background CSS is recorded separately from any unverified proposal to make it editable.

Do not mistake generic role names for an approved editorial model. A heading can become a title/name field only when source semantics or the destination modeling work supports it. Content within a rich-text owner remains owned formatted content; an actual embedded widget has its own validated boundary. Unassigned evidence stays explicit until an owner can be established.

Read the overview and relevant component family reports, then query authoritative JSON records for exact values. Combine with the destination platform's own skills. For each element or field set record the mapping to a CMS field/collection/reference, an owned supporting component, presentation/behavior-only responsibility or an unresolved requirement.

Observed formatting informs field semantics; a name such as description/body or CSS emphasis does not by itself establish rich-text editing. Preserve item versus section action ownership. A repeated component definition is not automatic authorization for globally shared content instances. Screenshot boxes are not automatic CMS types.

The discovery skill supplies evidence and candidate modeling roles; it never chooses Sitecore templates, SitecoreAI models, Optimizely content types, vendor SDK syntax, schema writes, publication or deployment. Those decisions belong to the destination developer workflow.

## Quality and continuation

Validate IDs and non-cyclic ownership, declared file references, occurrence coverage, measured style availability and source-relative geometry. Visual/semantic acceptance remains separate from structural validity. Discovery continues without a new mandatory human approval loop, preserving explicit gaps. When implementation requires evidence that was not captured, scope a targeted follow-up rather than silently claiming completeness or automatically recapturing every page.

The CLI writes quality findings and returns needs-reanalysis or provisional, never ready-for-implementation. The Kajoo agent reads affected native requests, re-inspects their exact images and uses preserved corrections with --replace. Limit automatic correction to two passes per affected tile, then expose remaining uncertainty instead of producing confident unsupported handoff prose.
