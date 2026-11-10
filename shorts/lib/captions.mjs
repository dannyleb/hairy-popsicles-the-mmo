// The words on screen, as an .ass file (styled: the game's fonts and colours)
// and a plain .srt (for uploading as separate captions).

const time = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const srtTime = (s) => time(s).replace(/^(\d):/, '0$1:').replace('.', ',') + '0';
const clean = (text) => text.replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();

// `lines`: [{ start, end, who, text }]; `title`: shown over the opening;
// `endcard`: { start, end, title, line } over the last card.
export function captionsAss({ size: [W, H], lines, names, title, endcard }) {
  const vertical = H > W;
  const big = vertical ? 74 : 62;
  const out = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Colours are &HAABBGGRR: cream text, near-black outline, the game's flesh pink for names and titles.
    `Style: Line,Patrick Hand,${big},&H00D6E8FF,&H000000FF,&H000D0A1A,&H96000000,0,0,0,0,100,100,0,0,1,${vertical ? 6 : 5},2,2,${Math.round(W * 0.08)},${Math.round(W * 0.08)},${Math.round(H * (vertical ? 0.12 : 0.08))},1`,
    `Style: Title,Rubik Wet Paint,${vertical ? 132 : 110},&H00A8C8F3,&H000000FF,&H000D0A1A,&H96000000,0,0,0,0,100,100,0,0,1,7,3,8,60,60,${Math.round(H * 0.1)},1`,
    `Style: End,Rubik Wet Paint,${vertical ? 150 : 120},&H00A8C8F3,&H000000FF,&H000D0A1A,&H96000000,0,0,0,0,100,100,0,0,1,7,3,5,60,60,0,1`,
    `Style: EndLine,Patrick Hand,${vertical ? 64 : 54},&H00D6E8FF,&H000000FF,&H000D0A1A,&H96000000,0,0,0,0,100,100,0,0,1,5,2,5,90,90,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  if (title) out.push(`Dialogue: 1,${time(0.1)},${time(2.6)},Title,,0,0,0,,{\\fad(250,450)}${clean(title)}`);
  for (const { start, end, who, text } of lines) {
    const name = names ? `{\\c&H00A8C8F3&\\fs${Math.round(big * 0.62)}}${clean(who).toUpperCase()}\\N{\\r}` : '';
    out.push(`Dialogue: 0,${time(start)},${time(end)},Line,,0,0,0,,${name}${clean(text)}`);
  }
  if (endcard) {
    const mid = Math.round(H / 2);
    out.push(`Dialogue: 1,${time(endcard.start)},${time(endcard.end)},End,,0,0,0,,{\\fad(300,0)\\pos(${W / 2},${mid - Math.round(H * 0.06)})}${clean(endcard.title)}`);
    if (endcard.line) out.push(`Dialogue: 1,${time(endcard.start + 0.3)},${time(endcard.end)},EndLine,,0,0,0,,{\\fad(300,0)\\pos(${W / 2},${mid + Math.round(H * 0.05)})}${clean(endcard.line)}`);
  }
  return `${out.join('\n')}\n`;
}

export function captionsSrt(lines) {
  return lines.map(({ start, end, text }, i) => `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${clean(text)}\n`).join('\n');
}
