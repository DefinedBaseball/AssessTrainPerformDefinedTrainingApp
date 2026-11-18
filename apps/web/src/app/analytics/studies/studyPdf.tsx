'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Study PDF: one landscape page (more when the table runs long) built with
   the same react-pdf parts as the report PDFs -- title rule, the headline,
   the key numbers, the chart, the explanation, "What we concluded" and the
   table. Takes what the study shows on screen (the result marks its parts
   with data-pdf="..."); the chart is drawn to an image in the light
   palette so it reads on a white page whatever theme the coach uses.
   ───────────────────────────────────────────────────────────────────────── */
import React from 'react';
import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { academyName } from '@/lib/academy';
import { PdfNotesBox, PdfTable, ReportHeader } from '@/lib/pdf/components';
import { saveBlob, renderPdf } from '@/lib/pdf/download';
import { colors, s } from '@/lib/pdf/theme';

interface Captured {
  headline: string;
  stats: { label: string; value: string; sub: string }[];
  notes: string[];
  explain: string[];
  chart: { src: string; w: number; h: number } | null;
  legend: { text: string; color: string }[];
  table: { head: string[]; rows: string[][] } | null;
}

const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The chart (first one in the result) as a PNG in the light palette, plus its legend. */
async function captureChart(root: HTMLElement): Promise<Pick<Captured, 'chart' | 'legend'>> {
  const viz = root.querySelector<HTMLElement>('[data-viz]');
  if (!viz) return { chart: null, legend: [] };
  const holder = document.createElement('div');
  holder.setAttribute('data-theme', 'light');
  holder.style.cssText = 'position:fixed;left:-30000px;top:0;width:960px;background:#ffffff;color:#1C2128;';
  const clone = viz.cloneNode(true) as HTMLElement;
  holder.appendChild(clone);
  document.body.appendChild(holder);
  try {
    const legend = [...clone.querySelectorAll('[data-legend-item]')].map((it) => ({
      text: txt(it),
      color: getComputedStyle(it.querySelector('span') ?? it).backgroundColor,
    }));
    const svg = clone.querySelector('svg');
    if (!svg) return { chart: null, legend };
    /* Resolve every CSS variable / class style into inline style so the
       stand-alone SVG draws the same. */
    svg.querySelectorAll<SVGElement>('*').forEach((el) => {
      const cs = getComputedStyle(el);
      el.style.fill = cs.fill;
      el.style.stroke = cs.stroke;
      el.style.opacity = cs.opacity;
      el.style.strokeWidth = cs.strokeWidth;
      el.style.strokeDasharray = cs.strokeDasharray;
      if (el.tagName.toLowerCase() === 'text') {
        el.style.fontSize = cs.fontSize;
        el.style.fontWeight = cs.fontWeight;
        el.style.fontFamily = 'Helvetica, Arial, sans-serif';
      }
    });
    const vb = svg.viewBox.baseVal;
    const w = vb.width || 640, h = vb.height || 360;
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new window.Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not draw the chart'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    });
    const scale = 2.5;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { chart: null, legend };
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { chart: { src: canvas.toDataURL('image/png'), w, h }, legend };
  } finally {
    holder.remove();
  }
}

async function capture(root: HTMLElement): Promise<Captured> {
  const tableEl = root.querySelector('[data-pdf="table"]');
  const table = tableEl ? {
    head: [...tableEl.querySelectorAll('thead th')].map((th) => txt(th)),
    rows: [...tableEl.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => txt(td))),
  } : null;
  return {
    headline: txt(root.querySelector('[data-pdf="headline"]')),
    stats: [...root.querySelectorAll('[data-pdf="stat"]')].map((el) => ({
      label: txt(el.querySelector('[data-pdf-part="label"]')),
      value: txt(el.querySelector('[data-pdf-part="value"]')),
      sub: txt(el.querySelector('[data-pdf-part="sub"]')),
    })),
    notes: [...root.querySelectorAll('[data-pdf="note"]')].map(txt).filter(Boolean),
    explain: [...root.querySelectorAll('[data-pdf="explain"]')].map(txt).filter(Boolean),
    ...(await captureChart(root)),
    table,
  };
}

const CONTENT_W = 792 - 72;

function StudyPdf({ title, subtitle, scope, conclusion, data, date }: {
  title: string; subtitle: string; scope: string; conclusion: string; data: Captured; date: string;
}) {
  const chartW = data.chart ? Math.min(CONTENT_W, (data.chart.w / data.chart.h) * 300) : 0;
  const tableCols = data.table?.head.map((h, i) => ({ key: String(i), header: h, align: (i ? 'right' : 'left') as 'left' | 'right', width: i ? undefined : '34%' })) ?? [];
  return (
    <Document title={title} author={academyName()} subject="Study">
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <ReportHeader title={title} subtitle={subtitle} />
        {scope ? <Text style={{ fontSize: 8, color: colors.textMuted, marginTop: -6, marginBottom: 8 }}>{scope}</Text> : null}
        {data.headline ? <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 8 }}>{data.headline}</Text> : null}
        {data.stats.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            {data.stats.map((st, i) => (
              <View key={i} style={{ border: `0.75px solid ${colors.cardBorder}`, borderRadius: 4, paddingVertical: 5, paddingHorizontal: 8, minWidth: 110 }}>
                <Text style={{ fontSize: 6.5, color: colors.textMuted, letterSpacing: 0.4 }}>{st.label.toUpperCase()}</Text>
                <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 2 }}>{st.value}</Text>
                {st.sub ? <Text style={{ fontSize: 6.5, color: colors.textMuted, marginTop: 1 }}>{st.sub}</Text> : null}
              </View>
            ))}
          </View>
        )}
        {data.notes.map((n, i) => (
          <Text key={i} style={{ fontSize: 8, color: colors.textDark, backgroundColor: '#FEF9C3', padding: 4, marginBottom: 6 }}>{n}</Text>
        ))}
        {data.legend.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
            {data.legend.map((l, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {l.color && l.color !== 'rgba(0, 0, 0, 0)' ? <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: l.color }} /> : null}
                <Text style={{ fontSize: 7.5, color: colors.textMuted }}>{l.text}</Text>
              </View>
            ))}
          </View>
        )}
        {data.chart && (
          <View style={{ alignItems: 'center', marginBottom: 6 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            <Image src={data.chart.src} style={{ width: chartW, height: (chartW * data.chart.h) / data.chart.w }} />
          </View>
        )}
        {data.explain.map((e, i) => <Text key={i} style={{ fontSize: 8, color: colors.textMuted, marginBottom: 4, lineHeight: 1.35 }}>{e}</Text>)}
        {conclusion.trim() ? <PdfNotesBox label="What we concluded" text={conclusion} /> : null}
        {data.table && data.table.rows.length > 0 && (
          <View break={data.table.rows.length > 8}>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 6 }}>Data</Text>
            <PdfTable columns={tableCols} rows={data.table.rows.map((r) => Object.fromEntries(r.map((v, i) => [String(i), v])))} />
          </View>
        )}
        <View style={s.pageFooter} fixed>
          <Text>{academyName()}  ·  {title}</Text>
          <Text render={({ pageNumber, totalPages }) => `${date}  ·  Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Build the study's PDF from what the result shows and download it. */
export async function downloadStudyPdf(root: HTMLElement, opts: { title: string; typeTitle: string; scope: string; conclusion: string }) {
  const data = await capture(root);
  const date = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const blob = await renderPdf(
    <StudyPdf title={opts.title || 'Study'} subtitle={`${opts.typeTitle} study · ${date}`} scope={opts.scope} conclusion={opts.conclusion} data={data} date={date} />,
  );
  saveBlob(blob, `${(opts.title || 'Study').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '_') || 'Study'}.pdf`);
}
