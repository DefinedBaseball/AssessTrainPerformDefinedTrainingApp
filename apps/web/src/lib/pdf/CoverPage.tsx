/**
 * PDF Cover Page — Dark navy background with logo
 */
import React from 'react';
import { Page, View, Text, Image } from '@react-pdf/renderer';
import { colors } from './theme';

interface CoverPageProps {
  player: {
    firstName: string;
    lastName: string;
    positions: string;
    gradYear: number | null;
    highSchool: string | null;
    clubTeam: string | null;
    collegeCommit: string | null;
  };
  reportTitle: string;
  reportDate: string;
}

export function CoverPage({ player, reportTitle, reportDate }: CoverPageProps) {
  return (
    <Page
      size="LETTER"
      style={{
        backgroundColor: colors.navy,
        padding: 0,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: 'Helvetica',
      }}
    >
      {/* Top accent bar */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          backgroundColor: colors.teal,
        }}
      />

      {/* Logo */}
      <View style={{ marginBottom: 40, alignItems: 'center' }}>
        <Image
          src="/logo.png"
          style={{ width: 120, height: 120, objectFit: 'contain' }}
        />
      </View>

      {/* Divider line */}
      <View style={{ width: 80, height: 2, backgroundColor: colors.teal, marginBottom: 30 }} />

      {/* Title */}
      <Text
        style={{
          fontSize: 12,
          color: colors.tealLight,
          letterSpacing: 4,
          textTransform: 'uppercase',
          fontFamily: 'Helvetica-Bold',
          marginBottom: 8,
        }}
      >
        SUMMER PRO ASSESSMENT
      </Text>

      <Text
        style={{
          fontSize: 28,
          color: colors.tealLight,
          fontFamily: 'Helvetica-Bold',
          letterSpacing: 2,
          marginBottom: 6,
          textTransform: 'uppercase',
        }}
      >
        {reportTitle}
      </Text>

      {/* Player Name */}
      <View style={{ marginTop: 40, alignItems: 'center' }}>
        <Text
          style={{
            fontSize: 36,
            color: colors.white,
            fontFamily: 'Helvetica-Bold',
            letterSpacing: 1,
          }}
        >
          {player.firstName} {player.lastName}
        </Text>

        {/* Player Details */}
        <View style={{ flexDirection: 'row', marginTop: 12, gap: 20 }}>
          {player.positions && (
            <Text style={{ fontSize: 11, color: colors.tealLight }}>
              {player.positions}
            </Text>
          )}
          {player.gradYear && (
            <Text style={{ fontSize: 11, color: colors.tealLight }}>
              Class of {player.gradYear}
            </Text>
          )}
        </View>

        {(player.highSchool || player.clubTeam) && (
          <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 6 }}>
            {player.highSchool || player.clubTeam}
          </Text>
        )}

        {player.collegeCommit && (
          <View style={{ marginTop: 14, alignItems: 'center' }}>
            <Text style={{ fontSize: 8, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>
              COMMITTED TO
            </Text>
            <Text style={{ fontSize: 14, color: colors.gold, fontFamily: 'Helvetica-Bold', marginTop: 4 }}>
              {player.collegeCommit}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom date */}
      <View style={{ position: 'absolute', bottom: 40, alignItems: 'center' }}>
        <View style={{ width: 40, height: 1, backgroundColor: colors.surface2, marginBottom: 12 }} />
        <Text style={{ fontSize: 9, color: colors.textMuted }}>
          {reportDate}
        </Text>
      </View>

      {/* Bottom accent bar */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 4,
          backgroundColor: colors.teal,
        }}
      />
    </Page>
  );
}
