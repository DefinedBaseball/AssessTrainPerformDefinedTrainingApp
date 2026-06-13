// AUTO-GENERATED from 'Drills Workbook.xlsx'. Do not edit by hand — regenerate
// when the workbook changes. SINGLE SOURCE OF TRUTH for each primary tab's
// ordered secondary tabs (categories) + their colors. Every drill-category UI
// surface (Drill Library, Training modal, Program board, legends) derives from
// this, so they can never drift apart.
export interface DrillCat { id: string; dot: string; bg: string; text: string; }
export const DRILL_TAXONOMY: Record<string, DrillCat[]> = {
  hitting: [
    { id: "Movement Prep", dot: "#ADCAEB", bg: "rgba(173,202,235,0.13)", text: "#ADCAEB" },
    { id: "Vision", dot: "#88B2E1", bg: "rgba(136,178,225,0.13)", text: "#88B2E1" },
    { id: "Tee", dot: "#6399D8", bg: "rgba(99,153,216,0.13)", text: "#6399D8" },
    { id: "Flips", dot: "#3D81CF", bg: "rgba(61,129,207,0.13)", text: "#3D81CF" },
    { id: "Batting Practice", dot: "#2C6AB1", bg: "rgba(44,106,177,0.13)", text: "#2C6AB1" },
    { id: "Machine", dot: "#23548B", bg: "rgba(35,84,139,0.13)", text: "#23548B" },
    { id: "Live", dot: "#193D66", bg: "rgba(25,61,102,0.13)", text: "#193D66" },
  ],
  pitching: [
    { id: "Movement Prep", dot: "#F9D09F", bg: "rgba(249,208,159,0.13)", text: "#F9D09F" },
    { id: "Plyo Balls", dot: "#F5B261", bg: "rgba(245,178,97,0.13)", text: "#F5B261" },
    { id: "Throw", dot: "#F19422", bg: "rgba(241,148,34,0.13)", text: "#F19422" },
    { id: "Bullpen", dot: "#C5720D", bg: "rgba(197,114,13,0.13)", text: "#C5720D" },
    { id: "Post Throw", dot: "#864E09", bg: "rgba(134,78,9,0.13)", text: "#864E09" },
  ],
  catching: [
    { id: "Movement Prep", dot: "#B0E8DD", bg: "rgba(176,232,221,0.13)", text: "#B0E8DD" },
    { id: "Vision", dot: "#85DCCA", bg: "rgba(133,220,202,0.13)", text: "#85DCCA" },
    { id: "Blocking", dot: "#5BCFB8", bg: "rgba(91,207,184,0.13)", text: "#5BCFB8" },
    { id: "Receiving", dot: "#37BCA1", bg: "rgba(55,188,161,0.13)", text: "#37BCA1" },
    { id: "Throwing", dot: "#2A917D", bg: "rgba(42,145,125,0.13)", text: "#2A917D" },
    { id: "Machine", dot: "#1E6758", bg: "rgba(30,103,88,0.13)", text: "#1E6758" },
  ],
  infield: [
    { id: "Movement Prep", dot: "#ABE3B6", bg: "rgba(171,227,182,0.13)", text: "#ABE3B6" },
    { id: "Vision", dot: "#84D694", bg: "rgba(132,214,148,0.13)", text: "#84D694" },
    { id: "Throw", dot: "#5DC972", bg: "rgba(93,201,114,0.13)", text: "#5DC972" },
    { id: "Glove", dot: "#3CB555", bg: "rgba(60,181,85,0.13)", text: "#3CB555" },
    { id: "Jumps/Routes", dot: "#2F8E42", bg: "rgba(47,142,66,0.13)", text: "#2F8E42" },
    { id: "Situational", dot: "#226730", bg: "rgba(34,103,48,0.13)", text: "#226730" },
  ],
  outfield: [
    { id: "Movement Prep", dot: "#D5E8B0", bg: "rgba(213,232,176,0.13)", text: "#D5E8B0" },
    { id: "Vision", dot: "#C1DD88", bg: "rgba(193,221,136,0.13)", text: "#C1DD88" },
    { id: "Throw", dot: "#ACD161", bg: "rgba(172,209,97,0.13)", text: "#ACD161" },
    { id: "Glove", dot: "#97C639", bg: "rgba(151,198,57,0.13)", text: "#97C639" },
    { id: "Jumps/Routes", dot: "#799E2E", bg: "rgba(121,158,46,0.13)", text: "#799E2E" },
    { id: "Situational", dot: "#5B7722", bg: "rgba(91,119,34,0.13)", text: "#5B7722" },
  ],
  strength: [
    { id: "Movement Prep", dot: "#F0B4B2", bg: "rgba(240,180,178,0.13)", text: "#F0B4B2" },
    { id: "Mobility", dot: "#E6817D", bg: "rgba(230,129,125,0.13)", text: "#E6817D" },
    { id: "Strength", dot: "#DC4E49", bg: "rgba(220,78,73,0.13)", text: "#DC4E49" },
    { id: "Speed", dot: "#C22A25", bg: "rgba(194,42,37,0.13)", text: "#C22A25" },
    { id: "Endurance", dot: "#8D1F1B", bg: "rgba(141,31,27,0.13)", text: "#8D1F1B" },
  ],
};
