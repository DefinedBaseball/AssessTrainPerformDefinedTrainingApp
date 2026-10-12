/**
 * Page geometry for the Player Summary PDF's screenshot pages, shared by
 * the PDF itself (generators.tsx) and the PDF Builder's preview so the two
 * always place a section identically. No react-pdf import here: the
 * builder loads this without pulling in the PDF renderer.
 *
 * Landscape LETTER is 792 × 612 pt. With 32pt padding the content box is
 * 728 × 548; the section title takes 26pt of that, leaving the image area
 * below it. The page footer sits in the bottom padding, outside the area.
 */
export const CAPTURE_PAGE = { width: 792, height: 612, padding: 32, titleBlock: 26 };

export const CAPTURE_AREA = {
  left: CAPTURE_PAGE.padding,
  top: CAPTURE_PAGE.padding + CAPTURE_PAGE.titleBlock,
  width: CAPTURE_PAGE.width - CAPTURE_PAGE.padding * 2,
  height: CAPTURE_PAGE.height - CAPTURE_PAGE.padding * 2 - CAPTURE_PAGE.titleBlock,
};

/** Where a screenshot goes inside the image area, in points relative to
 *  the area: scaled to fit BOTH the width (times the builder's Size) and
 *  the height, so it can never run off the page or under the footer, then
 *  placed by Vertical Position (0 top, 0.5 middle, 1 bottom) and centred
 *  across. */
export function fitCapture(s: { width: number; height: number; scale?: number; yOffset?: number }) {
  const scale = typeof s.scale === 'number' ? Math.max(0.1, Math.min(1, s.scale)) : 1;
  const yOffset = typeof s.yOffset === 'number' ? Math.max(0, Math.min(1, s.yOffset)) : 0.5;
  const aspect = s.width > 0 && s.height > 0 ? s.height / s.width : 1;
  const width = Math.min(CAPTURE_AREA.width * scale, CAPTURE_AREA.height / aspect);
  const height = width * aspect;
  return {
    width,
    height,
    left: (CAPTURE_AREA.width - width) / 2,
    top: (CAPTURE_AREA.height - height) * yOffset,
  };
}
