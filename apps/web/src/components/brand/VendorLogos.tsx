/* ─────────────────────────────────────────────────────────────────────────
   Data-provider marks drawn as small square tiles, the same treatment as
   the TrackMan / HitTrax / Full Swing / Blast marks on the Pitching and
   Hitting reports (fill their box: width/height 100%).
     MoveLogo -- MOVE Catching Sensor: the cyan + yellow brackets from the
                 MOVE wordmark on a dark tile (Catching Report).
     ValdLogo -- VALD Performance: the orange horned helmet on VALD's
                 charcoal tile (Lifting Report).
   ───────────────────────────────────────────────────────────────────────── */

export function MoveLogo() {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label="MOVE" style={{ display: 'block' }}>
      <rect x="0" y="0" width="100" height="100" rx="22" fill="#14161a" />
      {/* "[" cyan */}
      <path
        d="M 45 22 H 33 Q 25 22 25 30 V 70 Q 25 78 33 78 H 45"
        fill="none"
        stroke="#08d4ff"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* "]" yellow */}
      <path
        d="M 55 22 H 67 Q 75 22 75 30 V 70 Q 75 78 67 78 H 55"
        fill="none"
        stroke="#ffc20e"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ValdLogo() {
  const orange = '#ff8a1c';
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label="VALD" style={{ display: 'block' }}>
      <rect x="0" y="0" width="100" height="100" rx="22" fill="#222222" />
      {/* Horns: crescents sweeping up and out from the helmet's sides. */}
      <path d="M 19 14 Q 15 50 41 58 L 42 51 Q 24 44 19 14 Z" fill={orange} />
      <path d="M 81 14 Q 85 50 59 58 L 58 51 Q 76 44 81 14 Z" fill={orange} />
      {/* Helmet dome: pointed crown with stepped shoulders. */}
      <path d="M 33 66 V 58 L 41 58 L 50 45 L 59 58 L 67 58 V 66 Z" fill={orange} />
      {/* Brim bars */}
      <rect x="31" y="69.5" width="38" height="5" rx="1" fill={orange} />
      <rect x="31" y="77.5" width="38" height="2.5" rx="1" fill={orange} />
    </svg>
  );
}
