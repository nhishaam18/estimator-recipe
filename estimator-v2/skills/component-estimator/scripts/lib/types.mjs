export const VIEWPORT_SIZES = {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844 },
};
export const ALL_VIEWPORTS = ['desktop', 'mobile'];
const STEP_LABELS = {
    input: 'URLs', compare: 'Compare', screenshots: 'Screenshots', similar: 'Similar pages', detect: 'Detect', review: 'Review', dom: 'DOM view', build: 'Build list', report: 'Report',
};
const ORDER_SHOTS_FIRST = ['input', 'screenshots', 'similar', 'detect', 'review', 'dom', 'build', 'report'];
const ORDER_COMPARE_FIRST = ['input', 'compare', 'similar', 'screenshots', 'detect', 'review', 'dom', 'build', 'report'];
/** The wizard steps for a run, in order. Compare first groups pages from their DOM and screenshots only the chosen ones. */
export function stepsFor(mode) {
    return (mode === 'compare-first' ? ORDER_COMPARE_FIRST : ORDER_SHOTS_FIRST).map((key) => ({ key, label: STEP_LABELS[key] }));
}
/** The viewport the comparison runs on in compare-first mode: desktop when selected (mobile follows its choice), else mobile. */
export function compareViewport(viewports) {
    return viewports.includes('desktop') ? 'desktop' : viewports[0];
}
/** Pages scanned without a screenshot carry shot: false. Runs from before compare-first have no field and always have one. */
export const hasShot = (st) => st?.shot !== false;
export const STEPS = [
    { key: 'input', label: 'URLs' },
    { key: 'screenshots', label: 'Screenshots' },
    { key: 'similar', label: 'Similar pages' },
    { key: 'detect', label: 'Detect' },
    { key: 'review', label: 'Review' },
    { key: 'dom', label: 'DOM view' },
    { key: 'build', label: 'Build list' },
    { key: 'report', label: 'Report' },
];
