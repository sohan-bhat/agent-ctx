const STOP = new Set(
  (
    'a an and are as at be been but by can could did do does doing done for from had has have having he her here hers him his how i if in into is it its just me more most my no nor not of off on once only or other our ours out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours ' +
    'also about after again all am any because before below between both each few further let lets like make made need needs now ok okay please pls really get got go going want wants thing things way yes yeah sure still even every much many one two use used using new see look able sorry thanks thank right well back down same try tried src lib index util utils component components'
  ).split(' '),
);

function suffix(w: string): string {
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4 && !w.endsWith('eed')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

export function stem(w: string): string {
  if (w.length <= 3) return w;
  const s = suffix(w);
  if (s.length >= 4 && s.endsWith('e') && !s.endsWith('ee')) return s.slice(0, -1);
  return s;
}

export function tokens(text: string): string[] {
  if (!text) return [];
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const out: string[] = [];
  for (const raw of spaced.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || raw.length > 30) continue;
    if (/^\d+$/.test(raw) && raw.length > 4) continue;
    if (STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export function fileTokens(file: string): string[] {
  const parts = file.split('/').filter(Boolean);
  const base = parts[parts.length - 1] ?? '';
  const parent = parts[parts.length - 2] ?? '';
  const name = base.replace(/\.[a-z0-9]{1,6}$/i, '');
  return [...tokens(name), ...tokens(parent)];
}
