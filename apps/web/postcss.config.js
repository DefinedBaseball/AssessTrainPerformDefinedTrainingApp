/* Custom PostCSS chain. NOTE: defining this file REPLACES Next.js's built-in
 * defaults, so postcss-flexbugs-fixes + postcss-preset-env are re-declared
 * exactly as Next ships them (see Next docs "Customizing PostCSS Config").
 *
 * postcss-pxtorem is the fluid-sizing workhorse: it rewrites px → rem at
 * build time for FONT properties only (Phase 1), so every hardcoded
 * `font-size: 13px` across the 30+ CSS modules scales off the fluid root
 * font-size defined in globals.css (html { font-size: clamp(…) }).
 *
 *  - rootValue 15  → this app's base is `font-size: 15px`, NOT the browser
 *    default 16. Using 16 would shrink all text ~6% at full-screen.
 *  - propList      → fonts (Phase 1) + interior spacing/radius (Phase 2) so
 *    bubble chrome shrinks in step with the text. Deliberately EXCLUDED:
 *    width/height (icon boxes, toggles, video frames, chart canvases),
 *    top/left/right/bottom (absolute overlays + drawing surfaces), borders
 *    (hairlines stay crisp), box-shadow, and grid-template columns.
 *  - minPixelValue → values under 2px (hairline spacing) stay px.
 *  - selectorBlackList /^html$/ → the root clamp() itself must stay in px;
 *    rem on <html> resolves against the browser's 16px initial value and
 *    would silently re-scale the whole app.
 *  - mediaQuery false → @media breakpoints stay in device px.
 */
module.exports = {
  plugins: {
    'postcss-flexbugs-fixes': {},
    'postcss-preset-env': {
      autoprefixer: { flexbox: 'no-2009' },
      stage: 3,
      features: { 'custom-properties': false },
    },
    'postcss-pxtorem': {
      rootValue: 15,
      propList: [
        'font', 'font-size', 'line-height', 'letter-spacing',
        'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'gap', 'row-gap', 'column-gap',
        'border-radius',
      ],
      minPixelValue: 2,
      mediaQuery: false,
      selectorBlackList: [/^html$/],
      exclude: /node_modules/i,
    },
  },
};
