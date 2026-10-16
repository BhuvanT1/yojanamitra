/**
 * Stage 3 demo — free text to profile.
 *
 * Usage:
 *   npm run extract                       the three personas from the brief
 *   npm run extract -- "your text here"   anything you like, any language
 */

import { extractProfile } from '../src/extraction/extract';
const argv = process.argv.slice(2).filter((a) => a.trim().length > 0);
const inputs = argv.length
  ? argv
  : [
      "I'm 33, a farmer in Telangana with 1.5 acres of land in my village, OBC, my yearly income is around 1.5 lakh.",
      'widow, 52, bihar, no land, bpl card hai',
      'మా అమ్మాయి 11వ తరగతి, నేను రైతుని',
    ];
for (const i of inputs) {
  const r = extractProfile(i);
  console.log('='.repeat(72));
  console.log('INPUT :', i);
  console.log('SCRIPT:', r.profile.raw.detected_language, '/', r.profile.raw.script,
              '(conf', r.profile.raw.detection_confidence + ')');
  for (const [k, v] of Object.entries(r.profile)) {
    if (k === 'raw' || k === 'dependents') continue;
    const f = v as any;
    console.log(`  ${k.padEnd(20)} ${JSON.stringify(f.value).padEnd(28)} conf ${f.confidence}  ev ${JSON.stringify(f.evidence)}`);
  }
  for (const d of r.profile.dependents) {
    console.log(`  dependent ${d.id}:`, JSON.stringify({
      relation: d.relation?.value, gender: d.gender?.value, education_stage: d.education_stage?.value }));
  }
  console.log('  UNKNOWN:', r.unknown_fields.join(', '));
  console.log('  REJECTED:', r.rejected.length ? r.rejected : 'none');
}
