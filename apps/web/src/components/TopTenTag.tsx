import { rem } from '@/lib/rem';

/** Small "Top 10%" pill shown under a metric value that is at or better
 *  than the 90th percentile for the athlete's age (lib/age-norms). Takes
 *  the value's own colour so it reads as part of the number. */
export default function TopTenTag({ color }: { color?: string }) {
  return (
    <span style={{
      display: 'inline-block', marginTop: 2, padding: '1px 5px', borderRadius: 999,
      fontSize: rem(6.5), fontWeight: 700, letterSpacing: '0.05em',
      textTransform: 'uppercase', whiteSpace: 'nowrap', lineHeight: 1.4,
      color: color ?? 'var(--text)',
      border: `1px solid ${color ?? 'var(--border)'}`,
    }}>Top 10%</span>
  );
}
