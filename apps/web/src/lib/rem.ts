/**
 * px → rem against the app's 15px design base.
 *
 * CSS files get px→rem automatically at build time (postcss-pxtorem, see
 * postcss.config.js), but inline JSX style objects bypass PostCSS entirely —
 * a numeric `fontSize: 13` stays a fixed 13px and ignores the fluid root
 * font-size in globals.css. Inline styles use this helper instead so their
 * text scales with the window like everything else:
 *
 *   style={{ fontSize: rem(13) }}   // 13px at full scale, fluid below
 */
export const rem = (px: number) => `${(px / 15).toFixed(4)}rem`;
