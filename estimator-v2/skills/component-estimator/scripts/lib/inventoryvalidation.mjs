// Accounting units are detections per page/viewport, not unique build families.
export function summarizeValidation(pages) {
    const counts = { total: 0, component: 0, content: 0, part: 0, uncertain: 0, counted: 0 };
    const findings = [];
    for (const page of pages) for (const component of page.components) {
        const v = component.validation;
        if (!v) continue;
        counts.total++; counts[v.role]++;
        if (v.countInBuildList) counts.counted++;
        findings.push({ url: page.url, viewport: page.viewport, id: component.id, name: component.name, ...v });
    }
    return { version: 1, units: 'detections per page/viewport; not unique component families', counts, findings };
}
