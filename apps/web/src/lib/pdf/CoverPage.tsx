/**
 * PDF Cover Page — black background, white text. Layout (top → bottom):
 *
 *   D Logo
 *   ─────  (thin white divider)
 *   DEFINED BASEBALL ACADEMY        (eyebrow)
 *   Hitting Assessment              (report title)
 *
 *   Sheldon Johnson                 (player name)
 *   INF · P                         (positions subtitle)
 *
 *   L/L                             (bats/throws, value only)
 *   6'2"                            (height)
 *   195 lb                          (weight)
 *   2027                            (grad year)
 *
 *   Sample High School              (high school, value only)
 *   Sample Club                     (club team, value only)
 *
 *   [committed-to badge — only if collegeCommit is set]
 *
 *   ─                               (small divider above date)
 *   Date                            (footer)
 *
 * One unified type system — three sizes (eyebrow / value / display),
 * Helvetica + Helvetica-Bold only, consistent letter-spacing on every
 * uppercase eyebrow.
 */
import React from 'react';
import { Page, View, Text, Image } from '@react-pdf/renderer';
import { colors } from './theme';
import { formatHeight, formatPositionsForDisplay } from '@/app/athletes/[id]/helpers';

interface CoverPageProps {
  player: {
    firstName: string;
    lastName: string;
    positions: string | null;
    gradYear: number | null;
    highSchool: string | null;
    clubTeam: string | null;
    collegeCommit: string | null;
    heightInches?: number | null;
    weightLbs?: number | null;
    birthDate?: string | null;
    bats?: string | null;
    throws?: string | null;
  };
  reportTitle: string;
  reportDate: string;
}

/* ── Type tokens ──────────────────────────────────────────────────────────
   Centralised so every text element on the cover pulls from the same
   small palette. If we ever want to tune the page, change one number
   here instead of hunting through inline styles.
   ──────────────────────────────────────────────────────────────────── */
const FONT = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
};
const SIZE = {
  eyebrow: 8.5,    // small uppercase labels (e.g. "BATS", "HEIGHT")
  body:    13,     // standard value text (e.g. "L", "6'2\"")
  brand:   10.5,   // "DEFINED BASEBALL ACADEMY"
  title:   24,     // "HITTING ASSESSMENT"
  name:    30,     // player name
  position:11.5,   // positions subtitle (e.g. "INF · P")
  commit:  18,     // college commit value
  date:    9.5,    // footer date
};
const COLOR = {
  primary:   colors.white,
  secondary: 'rgba(255,255,255,0.65)', // softened white for eyebrow labels
  divider:   'rgba(255,255,255,0.45)',
};

/* ── ValueLine — one centered value, no label ─────────────────────────
   Personal-info rows on the cover are label-less per the minimalist
   spec. Reader infers each line from its content + position.
   ──────────────────────────────────────────────────────────────────── */
function ValueLine({
  value, marginTop = 0,
}: {
  value: string;
  marginTop?: number;
}) {
  return (
    <Text style={{
      fontSize: SIZE.body, color: COLOR.primary,
      fontFamily: FONT.bold,
      textAlign: 'center',
      marginTop,
    }}>
      {value}
    </Text>
  );
}

export function CoverPage({ player, reportTitle, reportDate }: CoverPageProps) {
  /* Cover-page positions roll up to display labels per coach spec:
       • SS / 2B / 1B / 3B (or umbrella INF) → "INF"
       • LF / CF / RF (or umbrella OF)        → "OF"
       • C                                    → "Catcher"
       • P                                    → "Pitcher"
     so a player saved as `SS,2B,P` reads "INF · Pitcher" on the
     cover instead of "SS · 2B · P". See `formatPositionsForDisplay`
     in helpers.ts for the full mapping. */
  const positions = formatPositionsForDisplay(player.positions);
  const heightStr = formatHeight(player.heightInches ?? null);
  const weightStr = player.weightLbs ? `${player.weightLbs} lb` : '—';
  const batsStr   = player.bats || '—';
  const throwsStr = player.throws || '—';
  const gradStr   = player.gradYear ? String(player.gradYear) : '—';

  return (
    <Page
      size="LETTER"
      /* Landscape so the title page matches the section pages — the
         rest of the Summary PDF is landscape (Tool Grades / Hitting /
         Catching / Infield / Outfield / Pitching snapshots), and the
         PDF Builder modal's previews are all rendered at 11:8.5
         landscape. Without this, the cover page came out portrait
         and read as a different ratio than the rest of the deck. */
      orientation="landscape"
      style={{
        backgroundColor: colors.black,
        padding: 0,
        fontFamily: FONT.regular,
      }}
    >
      {/* ── Logo + brand block ───────────────────────────────────── */}
      <View style={{ marginTop: 70, alignItems: 'center' }}>
        <Image
          src="/logo.png"
          style={{ width: 84, height: 84, objectFit: 'contain', marginBottom: 14 }}
        />

        {/* Single thin divider directly under the logo */}
        <View style={{
          width: 70, height: 1.2,
          backgroundColor: COLOR.primary,
          marginBottom: 16,
        }} />

        {/* DEFINED BASEBALL ACADEMY (eyebrow) */}
        <Text style={{
          fontSize: SIZE.brand, color: COLOR.primary,
          fontFamily: FONT.bold,
          textTransform: 'uppercase', letterSpacing: 4,
          marginBottom: 10,
        }}>
          DEFINED BASEBALL ACADEMY
        </Text>

        {/* Report title — bigger, less letter-spaced for readability */}
        <Text style={{
          fontSize: SIZE.title, color: COLOR.primary,
          fontFamily: FONT.bold,
          textTransform: 'uppercase', letterSpacing: 2,
        }}>
          {reportTitle}
        </Text>
      </View>

      {/* ── Player block ─────────────────────────────────────────── */}
      <View style={{
        /* Top gap halved (44 → 22) so the title → divider → player-name
           sequence reads as one tight block. Paired with the divider's
           halved bottom margin below, the total gap from the report
           title to the player name is now 50 % of the previous rhythm. */
        marginTop: 22,
        marginHorizontal: 60,
        alignItems: 'center',
      }}>
        {/* Divider line between report title and player name —
            visually breaks the "what this report is" block from the
            "who it's about" block, mirroring the divider under the logo.
            Bottom margin halved (26 → 13) per the tightened spacing
            spec; pairs with the player block's halved top margin above. */}
        <View style={{
          width: 70, height: 1.2,
          backgroundColor: COLOR.primary,
          marginBottom: 13,
        }} />

        {/* Player name */}
        <Text style={{
          fontSize: SIZE.name, color: COLOR.primary,
          fontFamily: FONT.bold,
          letterSpacing: 0.5,
          marginBottom: 6,
        }}>
          {player.firstName} {player.lastName}
        </Text>

        {/* Positions */}
        <Text style={{
          fontSize: SIZE.position, color: COLOR.primary,
          fontFamily: FONT.bold,
          textTransform: 'uppercase', letterSpacing: 3,
        }}>
          {positions}
        </Text>

        {/* Personal-info rows — values only, no labels.
            Each line is the bare data point (e.g. "L/L", "6'2\"", "195 lb",
            "2027"), centered. Affiliations follow the same value-only
            treatment. The reader infers what each line is from its
            position and content; this matches the minimalist title-page
            spec. */}
        {/* First value row uses the SAME 10pt gap as the rest, so the
            spacing from the position subtitle to L/L matches the spacing
            between L/L → 6'1" → 195 lb → 2028. No extra blank line. */}
        <ValueLine value={`${batsStr}/${throwsStr}`} marginTop={10} />
        <ValueLine value={heightStr}                marginTop={10} />
        <ValueLine value={weightStr}                marginTop={10} />
        <ValueLine value={gradStr}                  marginTop={10} />

        {/* Affiliations gap halved (22 → 11) to match the new tighter
            rhythm between the report title, divider, and player name
            above. Keeps the cover page reading as one consistent
            cadence instead of mixing wide and tight gaps. */}
        {player.highSchool && (
          <ValueLine value={player.highSchool} marginTop={11} />
        )}
        {player.clubTeam && (
          <ValueLine value={player.clubTeam}   marginTop={6} />
        )}

        {/* Committed-To badge moved OUT of the player block per spec —
            it now renders inside the bottom footer container below,
            ABOVE the date divider/text, with the border stripped. */}
      </View>

      {/* ── Footer: Committed-To (above) + Date (below) ─────────────
          Single bottom-anchored stack so the Committed-To block sits
          directly above the date divider. The badge's white border +
          tinted fill have been stripped entirely — the text alone
          carries the read, no rim to muddy the black canvas. */}
      <View style={{
        position: 'absolute', bottom: 44, left: 0, right: 0,
        alignItems: 'center',
      }}>
        {player.collegeCommit && (
          <View style={{
            alignItems: 'center',
            marginBottom: 18,
            /* No border, no background fill, no rounded corners — the
               eyebrow label + commit text stand alone over the black
               page (matches the rest of the cover's minimalist
               value-only treatment). */
          }}>
            <Text style={{
              fontSize: SIZE.eyebrow, color: COLOR.secondary,
              fontFamily: FONT.bold,
              textTransform: 'uppercase', letterSpacing: 2,
              marginBottom: 4,
            }}>
              Committed To
            </Text>
            <Text style={{
              fontSize: SIZE.commit, color: COLOR.primary,
              fontFamily: FONT.bold,
            }}>
              {player.collegeCommit}
            </Text>
          </View>
        )}
        <View style={{
          width: 36, height: 1,
          backgroundColor: COLOR.divider,
          marginBottom: 10,
        }} />
        <Text style={{
          fontSize: SIZE.date, color: COLOR.primary,
          fontFamily: FONT.regular,
          letterSpacing: 1.2,
        }}>
          {reportDate}
        </Text>
      </View>
    </Page>
  );
}
