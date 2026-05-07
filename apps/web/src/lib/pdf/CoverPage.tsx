/**
 * PDF Cover Page — Dark navy background.
 * Lists every piece of personal information we have on file for the player:
 *   name · positions · grad year · age · height · weight · bats/throws ·
 *   high school · club team · college commitment.
 */
import React from 'react';
import { Page, View, Text, Image } from '@react-pdf/renderer';
import { colors } from './theme';
import { formatHeight, getAge } from '@/app/athletes/[id]/helpers';

interface CoverPageProps {
  player: {
    firstName: string;
    lastName: string;
    positions: string | null;
    gradYear: number | null;
    highSchool: string | null;
    clubTeam: string | null;
    collegeCommit: string | null;
    /** Personal info — all optional so missing fields just hide their stat tile. */
    heightInches?: number | null;
    weightLbs?: number | null;
    birthDate?: string | null;
    bats?: string | null;
    throws?: string | null;
  };
  reportTitle: string;
  reportDate: string;
}

/** Small stat tile used in the personal-info grid. */
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={{
      width: '30%',
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderWidth: 0.5,
      borderColor: colors.surface2,
      borderRadius: 4,
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.02)',
    }}>
      <Text style={{
        fontSize: 7, color: colors.textMuted,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
      }}>
        {label}
      </Text>
      <Text style={{
        fontSize: 13, color: colors.white,
        fontFamily: 'Helvetica-Bold',
      }}>
        {value}
      </Text>
    </View>
  );
}

export function CoverPage({ player, reportTitle, reportDate }: CoverPageProps) {
  const positions = (player.positions || '').split(',').map(p => p.trim()).filter(Boolean).join(' · ') || '—';
  const ageStr = getAge(player.birthDate ?? null, player.gradYear ?? null);
  const heightStr = formatHeight(player.heightInches ?? null);
  const weightStr = player.weightLbs ? `${player.weightLbs} lb` : '—';
  const btStr = `${player.bats || '—'} / ${player.throws || '—'}`;
  const gradStr = player.gradYear ? String(player.gradYear) : '—';

  return (
    <Page
      size="LETTER"
      style={{
        backgroundColor: colors.navy,
        padding: 0,
        fontFamily: 'Helvetica',
      }}
    >
      {/* Top accent bar */}
      <View style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 4, backgroundColor: colors.teal,
      }} />

      {/* Header — logo, label, report title */}
      <View style={{
        marginTop: 70,
        alignItems: 'center',
      }}>
        <Image
          src="/logo.png"
          style={{ width: 90, height: 90, objectFit: 'contain', marginBottom: 18 }}
        />
        <View style={{ width: 80, height: 2, backgroundColor: colors.teal, marginBottom: 18 }} />
        <Text style={{
          fontSize: 11, color: colors.tealLight,
          letterSpacing: 4, textTransform: 'uppercase',
          fontFamily: 'Helvetica-Bold', marginBottom: 6,
        }}>
          SUMMER PRO ASSESSMENT
        </Text>
        <Text style={{
          fontSize: 24, color: colors.tealLight,
          fontFamily: 'Helvetica-Bold', letterSpacing: 1.5,
          textTransform: 'uppercase',
        }}>
          {reportTitle}
        </Text>
      </View>

      {/* Player block — name, positions, complete personal info grid */}
      <View style={{
        marginTop: 38,
        marginHorizontal: 60,
        alignItems: 'center',
      }}>
        <Text style={{
          fontSize: 32, color: colors.white,
          fontFamily: 'Helvetica-Bold', letterSpacing: 1,
          marginBottom: 4,
        }}>
          {player.firstName} {player.lastName}
        </Text>
        <Text style={{
          fontSize: 11, color: colors.tealLight,
          textTransform: 'uppercase', letterSpacing: 2.5,
        }}>
          {positions}
        </Text>

        {/* Personal info grid — five stat tiles in the requested order:
            Height · Weight · Bats/Throws · Grad Year · Age. Position
            already lives in the uppercase subtitle directly under the
            player name, so it's omitted from this row. */}
        <View style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 8,
          marginTop: 22,
          width: '100%',
        }}>
          <StatTile label="Height"        value={heightStr} />
          <StatTile label="Weight"        value={weightStr} />
          <StatTile label="Bats / Throws" value={btStr} />
          <StatTile label="Grad Year"     value={gradStr} />
          <StatTile label="Age"           value={ageStr} />
        </View>

        {/* Affiliations + commit */}
        <View style={{
          marginTop: 24,
          width: '100%',
          alignItems: 'center',
          gap: 4,
        }}>
          {player.highSchool && (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={{ fontSize: 8, color: colors.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                High School
              </Text>
              <Text style={{ fontSize: 11, color: colors.white, fontFamily: 'Helvetica-Bold' }}>
                {player.highSchool}
              </Text>
            </View>
          )}
          {player.clubTeam && (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={{ fontSize: 8, color: colors.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                Club Team
              </Text>
              <Text style={{ fontSize: 11, color: colors.white, fontFamily: 'Helvetica-Bold' }}>
                {player.clubTeam}
              </Text>
            </View>
          )}
        </View>

        {player.collegeCommit && (
          <View style={{
            marginTop: 22,
            alignItems: 'center',
            paddingVertical: 12,
            paddingHorizontal: 24,
            borderWidth: 1,
            borderColor: colors.gold,
            borderRadius: 6,
            backgroundColor: 'rgba(232,175,52,0.08)',
          }}>
            <Text style={{
              fontSize: 8, color: colors.textMuted,
              textTransform: 'uppercase', letterSpacing: 2,
            }}>
              Committed To
            </Text>
            <Text style={{
              fontSize: 16, color: colors.gold,
              fontFamily: 'Helvetica-Bold', marginTop: 4,
            }}>
              {player.collegeCommit}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom date */}
      <View style={{
        position: 'absolute', bottom: 40, left: 0, right: 0,
        alignItems: 'center',
      }}>
        <View style={{ width: 40, height: 1, backgroundColor: colors.surface2, marginBottom: 10 }} />
        <Text style={{ fontSize: 9, color: colors.textMuted, letterSpacing: 1 }}>
          {reportDate}
        </Text>
      </View>

      {/* Bottom accent bar */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 4, backgroundColor: colors.teal,
      }} />
    </Page>
  );
}
