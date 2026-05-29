/** @jsxImportSource preact */
import { useState, useEffect, useMemo } from 'preact/hooks';
import {
  computeEffect,
  poolRandomEffects,
  type StudyData,
  type EffectMeasure,
} from '../lib/stats';
import { fmtRR, fmtCI, fmtPct, fmtNN } from '../lib/format';

/* ---------- form state types (strings for editable numbers) ---------- */
type Direction = 'lowerIsBetter' | 'higherIsBetter';
type Design =
  | 'DB-RCT' | 'RCT' | 'pre-post' | 'prospective' | 'retrospective'
  | 'case-control' | 'cohort' | 'ecological' | 'review';

interface OutcomeForm {
  id: string;
  label: string;
  direction: Direction;
}

interface StudyForm {
  id: string;
  author: string;
  year: string;
  citation: string;
  doi: string;
  url: string;
  design: Design;
  outcomeId: string;
  doseRegimen: string;
  population: string;
  excludeFromPooled: boolean;
  notes: string;
  mode: '2x2' | 'effect';
  // 2x2
  txEvents: string;
  txTotal: string;
  ctrlEvents: string;
  ctrlTotal: string;
  // effect
  measure: EffectMeasure;
  point: string;
  ciLow: string;
  ciHigh: string;
  ctrlRisk: string;
}

interface TopicForm {
  slug: string;
  name: string;
  condition: string;
  intervention: string;
  comparator: string;
  category: string;
  evidenceClass: 'efficacy' | 'implementation' | 'observational';
  summary: string;
  description: string;
  interpretation: string;
  methodologyNotes: string;
  primaryOutcomeId: string;
  lastUpdated: string;
  outcomes: OutcomeForm[];
  studies: StudyForm[];
}

const STORAGE_KEY = 'ehvidence-draft-v1';
const WEBMASTER = 'ehvidence@robbiemed.org';
const DESIGNS: Design[] = ['DB-RCT', 'RCT', 'pre-post', 'prospective', 'retrospective', 'case-control', 'cohort', 'ecological', 'review'];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Trigger a client-side download of a JSON string. */
function triggerDownload(slug: string, json: string): void {
  const a = document.createElement('a');
  a.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  a.download = `${slug}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function emptyStudy(outcomeId: string): StudyForm {
  return {
    id: uid('study'),
    author: '', year: '', citation: '', doi: '', url: '',
    design: 'RCT', outcomeId, doseRegimen: '', population: '',
    excludeFromPooled: false, notes: '', mode: '2x2',
    txEvents: '', txTotal: '', ctrlEvents: '', ctrlTotal: '',
    measure: 'RR', point: '', ciLow: '', ciHigh: '', ctrlRisk: '',
  };
}

function initialTopic(): TopicForm {
  const oid = uid('outcome');
  return {
    slug: '', name: '', condition: '', intervention: '', comparator: '',
    category: '', evidenceClass: 'efficacy', summary: '', description: '', interpretation: '', methodologyNotes: '',
    primaryOutcomeId: oid, lastUpdated: today(),
    outcomes: [{ id: oid, label: 'Primary outcome', direction: 'lowerIsBetter' }],
    studies: [],
  };
}

/* ---------- convert a study form to StudyData for computation ---------- */
function toStudyData(s: StudyForm): StudyData | null {
  if (s.mode === '2x2') {
    const a = Number(s.txEvents), n1 = Number(s.txTotal), c = Number(s.ctrlEvents), n2 = Number(s.ctrlTotal);
    if (![a, n1, c, n2].every(Number.isFinite) || n1 <= 0 || n2 <= 0) return null;
    return { kind: '2x2', txEvents: a, txTotal: n1, ctrlEvents: c, ctrlTotal: n2 };
  }
  const point = Number(s.point), lo = Number(s.ciLow), hi = Number(s.ciHigh);
  if (![point, lo, hi].every(Number.isFinite) || point <= 0 || lo <= 0 || hi <= 0) return null;
  const ctrlRisk = s.ctrlRisk.trim() === '' ? undefined : Number(s.ctrlRisk);
  return { kind: 'effect', measure: s.measure, point, ciLow: lo, ciHigh: hi, ctrlRisk };
}

function studyWarnings(s: StudyForm): string[] {
  const w: string[] = [];
  if (s.mode === '2x2') {
    const a = Number(s.txEvents), n1 = Number(s.txTotal), c = Number(s.ctrlEvents), n2 = Number(s.ctrlTotal);
    if (s.txTotal && a > n1) w.push('Treatment events exceed treatment total.');
    if (s.ctrlTotal && c > n2) w.push('Control events exceed control total.');
    if (s.txTotal && s.ctrlTotal && (a === 0 || c === 0)) w.push('Zero cell present — a continuity correction is applied for the CI.');
  } else {
    const lo = Number(s.ciLow), hi = Number(s.ciHigh), p = Number(s.point);
    if (lo && hi && lo > hi) w.push('CI lower bound is above the upper bound.');
    if (p && lo && hi && (p < lo || p > hi)) w.push('Point estimate is outside its CI.');
    if (s.measure !== 'RR') w.push('OR/HR is treated as an RR-approximation.');
    if (s.ctrlRisk.trim() === '') w.push('No control risk given — NNT will be omitted for this study.');
  }
  return w;
}

/* ---------- build a clean export object with canonical key order ---------- */
function buildExport(t: TopicForm): unknown {
  const studies = t.studies.map((s) => {
    const base: Record<string, unknown> = {
      id: s.id,
      author: s.author,
      year: Number(s.year),
      citation: s.citation,
    };
    if (s.doi.trim()) base.doi = s.doi.trim();
    if (s.url.trim()) base.url = s.url.trim();
    base.design = s.design;
    base.outcomeId = s.outcomeId;
    if (s.doseRegimen.trim()) base.doseRegimen = s.doseRegimen.trim();
    if (s.population.trim()) base.population = s.population.trim();
    if (s.excludeFromPooled) base.excludeFromPooled = true;
    if (s.notes.trim()) base.notes = s.notes.trim();
    base.data =
      s.mode === '2x2'
        ? { kind: '2x2', txEvents: Number(s.txEvents), txTotal: Number(s.txTotal), ctrlEvents: Number(s.ctrlEvents), ctrlTotal: Number(s.ctrlTotal) }
        : {
            kind: 'effect', measure: s.measure, point: Number(s.point),
            ciLow: Number(s.ciLow), ciHigh: Number(s.ciHigh),
            ...(s.ctrlRisk.trim() ? { ctrlRisk: Number(s.ctrlRisk) } : {}),
          };
    return base;
  });

  const out: Record<string, unknown> = {
    slug: t.slug,
    name: t.name,
    condition: t.condition,
    intervention: t.intervention,
    comparator: t.comparator,
    category: t.category,
    evidenceClass: t.evidenceClass,
    summary: t.summary,
  };
  if (t.description.trim()) out.description = t.description.trim();
  if (t.interpretation.trim()) out.interpretation = t.interpretation.trim();
  if (t.methodologyNotes.trim()) out.methodologyNotes = t.methodologyNotes.trim();
  out.primaryOutcomeId = t.primaryOutcomeId;
  out.lastUpdated = t.lastUpdated;
  out.outcomes = t.outcomes.map((o) => ({ id: o.id, label: o.label, direction: o.direction }));
  out.studies = studies;
  return out;
}

/* ---------- import: map a topic JSON back into form state ---------- */
function fromImport(raw: any): TopicForm {
  const studies: StudyForm[] = (raw.studies ?? []).map((s: any) => {
    const base = emptyStudy(s.outcomeId ?? '');
    Object.assign(base, {
      id: s.id ?? uid('study'),
      author: s.author ?? '', year: String(s.year ?? ''),
      citation: s.citation ?? '', doi: s.doi ?? '', url: s.url ?? '',
      design: s.design ?? 'RCT', outcomeId: s.outcomeId ?? '',
      doseRegimen: s.doseRegimen ?? '', population: s.population ?? '',
      excludeFromPooled: !!s.excludeFromPooled, notes: s.notes ?? '',
    });
    if (s.data?.kind === 'effect') {
      base.mode = 'effect';
      base.measure = s.data.measure ?? 'RR';
      base.point = String(s.data.point ?? '');
      base.ciLow = String(s.data.ciLow ?? '');
      base.ciHigh = String(s.data.ciHigh ?? '');
      base.ctrlRisk = s.data.ctrlRisk != null ? String(s.data.ctrlRisk) : '';
    } else if (s.data?.kind === '2x2') {
      base.mode = '2x2';
      base.txEvents = String(s.data.txEvents ?? '');
      base.txTotal = String(s.data.txTotal ?? '');
      base.ctrlEvents = String(s.data.ctrlEvents ?? '');
      base.ctrlTotal = String(s.data.ctrlTotal ?? '');
    }
    return base;
  });
  return {
    slug: raw.slug ?? '', name: raw.name ?? '', condition: raw.condition ?? '',
    intervention: raw.intervention ?? '', comparator: raw.comparator ?? '',
    category: raw.category ?? '', evidenceClass: raw.evidenceClass ?? 'efficacy', summary: raw.summary ?? '',
    description: raw.description ?? '', interpretation: raw.interpretation ?? '',
    methodologyNotes: raw.methodologyNotes ?? '',
    primaryOutcomeId: raw.primaryOutcomeId ?? (raw.outcomes?.[0]?.id ?? ''),
    lastUpdated: raw.lastUpdated ?? today(),
    outcomes: (raw.outcomes ?? []).map((o: any) => ({ id: o.id, label: o.label, direction: o.direction ?? 'lowerIsBetter' })),
    studies,
  };
}

/* ====================================================================== */
export default function DataEntryApp() {
  const [topic, setTopic] = useState<TopicForm>(initialTopic);
  const [exported, setExported] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // hydrate from localStorage once
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setTopic(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);
  // persist on change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(topic)); } catch { /* ignore */ }
  }, [topic]);

  const setField = <K extends keyof TopicForm>(k: K, v: TopicForm[K]) =>
    setTopic((t) => ({ ...t, [k]: v }));

  const updateStudy = (id: string, patch: Partial<StudyForm>) =>
    setTopic((t) => ({ ...t, studies: t.studies.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const addStudy = () =>
    setTopic((t) => ({ ...t, studies: [...t.studies, emptyStudy(t.primaryOutcomeId)] }));
  const duplicateStudy = (id: string) =>
    setTopic((t) => {
      const src = t.studies.find((s) => s.id === id);
      if (!src) return t;
      return { ...t, studies: [...t.studies, { ...src, id: uid('study') }] };
    });
  const deleteStudy = (id: string) =>
    setTopic((t) => ({ ...t, studies: t.studies.filter((s) => s.id !== id) }));

  const addOutcome = () =>
    setTopic((t) => {
      const o = { id: uid('outcome'), label: 'New outcome', direction: 'lowerIsBetter' as Direction };
      return { ...t, outcomes: [...t.outcomes, o] };
    });
  const updateOutcome = (id: string, patch: Partial<OutcomeForm>) =>
    setTopic((t) => ({ ...t, outcomes: t.outcomes.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  const deleteOutcome = (id: string) =>
    setTopic((t) => (t.outcomes.length <= 1 ? t : { ...t, outcomes: t.outcomes.filter((o) => o.id !== id) }));

  // live pooled preview for the primary outcome
  const preview = useMemo(() => {
    const items = topic.studies
      .filter((s) => s.outcomeId === topic.primaryOutcomeId && !s.excludeFromPooled)
      .map(toStudyData)
      .filter((d): d is StudyData => d !== null);
    return poolRandomEffects(items);
  }, [topic]);

  const doExport = () => {
    setExported(JSON.stringify(buildExport(topic), null, 2));
    setCopied(false);
  };
  const doCopy = async () => {
    const text = exported || JSON.stringify(buildExport(topic), null, 2);
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* ignore */ }
  };
  const doEmail = () => {
    const json = JSON.stringify(buildExport(topic), null, 2);
    setExported(json);
    setCopied(false);
    const slug = topic.slug || 'topic';
    // Download the file too, so the sender can attach it if their mail client
    // truncates a long mailto body.
    triggerDownload(slug, json);
    const subject = `Ehvidence topic submission: ${slug}`;
    const intro =
      `Please add this topic to Ehvidence.\n\n` +
      `Topic: ${topic.name || '(unnamed)'}\n` +
      `Slug: ${slug}\n\n` +
      `The JSON for src/content/topics/${slug}.json is below. If it looks ` +
      `truncated, the file "${slug}.json" was also downloaded — please attach ` +
      `that instead.\n\n----- BEGIN JSON -----\n`;
    const body = `${intro}${json}\n----- END JSON -----\n`;
    window.location.href = `mailto:${WEBMASTER}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  const doImport = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      setTopic(fromImport(parsed));
      setExported('');
    } catch (e) {
      alert('Could not parse JSON: ' + (e as Error).message);
    }
  };
  const onFile = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    file.text().then(doImport);
  };
  const reset = () => {
    if (confirm('Clear the current draft?')) { setTopic(initialTopic()); setExported(''); }
  };

  return (
    <div class="gui">
      {/* ---------------- topic ---------------- */}
      <div class="card">
        <h3>Topic</h3>
        <div class="grid">
          <Field label="Slug (url id)"><input value={topic.slug} onInput={(e) => setField('slug', val(e))} placeholder="vitamin-k-vkdb" /></Field>
          <Field label="Name"><input value={topic.name} onInput={(e) => setField('name', val(e))} /></Field>
          <Field label="Category"><input value={topic.category} onInput={(e) => setField('category', val(e))} placeholder="Neonatal" /></Field>
          <Field label="Evidence type">
            <select value={topic.evidenceClass} onChange={(e) => setField('evidenceClass', val(e) as TopicForm['evidenceClass'])}>
              <option value="efficacy">Efficacy (RCT)</option>
              <option value="implementation">Implementation / QI</option>
              <option value="observational">Observational</option>
            </select>
          </Field>
          <Field label="Condition"><input value={topic.condition} onInput={(e) => setField('condition', val(e))} /></Field>
          <Field label="Intervention"><input value={topic.intervention} onInput={(e) => setField('intervention', val(e))} /></Field>
          <Field label="Comparator"><input value={topic.comparator} onInput={(e) => setField('comparator', val(e))} /></Field>
          <Field label="Last updated"><input value={topic.lastUpdated} onInput={(e) => setField('lastUpdated', val(e))} /></Field>
        </div>
        <div style="margin-top:.6rem">
          <Field label="Summary"><textarea rows={2} value={topic.summary} onInput={(e) => setField('summary', val(e))} /></Field>
        </div>
        <div style="margin-top:.6rem">
          <Field label="Background (optional)"><textarea rows={2} value={topic.description} onInput={(e) => setField('description', val(e))} /></Field>
        </div>
        <div style="margin-top:.6rem">
          <Field label="Interpretation & tips (optional) — shown prominently; define terms, flag caveats, tell the reader how to read the data. One paragraph per line.">
            <textarea rows={3} value={topic.interpretation} onInput={(e) => setField('interpretation', val(e))}
              placeholder="e.g. Late VKDB is bleeding after the first week, often intracranial. No RCT has measured it, so those estimates are surveillance-based." />
          </Field>
        </div>
        <div style="margin-top:.6rem">
          <Field label="Methodology notes / caveats (optional)"><textarea rows={2} value={topic.methodologyNotes} onInput={(e) => setField('methodologyNotes', val(e))} /></Field>
        </div>
      </div>

      {/* ---------------- outcomes ---------------- */}
      <div class="card">
        <h3>Outcomes</h3>
        {topic.outcomes.map((o) => (
          <div class="row" key={o.id} style="margin-bottom:.5rem">
            <div style="flex:1 1 180px"><Field label="Label"><input value={o.label} onInput={(e) => updateOutcome(o.id, { label: val(e) })} /></Field></div>
            <div style="flex:0 0 160px"><Field label="Direction">
              <select value={o.direction} onChange={(e) => updateOutcome(o.id, { direction: val(e) as Direction })}>
                <option value="lowerIsBetter">lower is better</option>
                <option value="higherIsBetter">higher is better</option>
              </select>
            </Field></div>
            <div style="flex:0 0 140px"><Field label="Primary?">
              <input type="radio" name="primary" checked={topic.primaryOutcomeId === o.id} onChange={() => setField('primaryOutcomeId', o.id)} />
            </Field></div>
            <button class="danger" onClick={() => deleteOutcome(o.id)} disabled={topic.outcomes.length <= 1}>Remove</button>
          </div>
        ))}
        <button class="secondary" onClick={addOutcome}>+ Add outcome</button>
      </div>

      {/* ---------------- studies ---------------- */}
      <h3>Studies ({topic.studies.length})</h3>
      {topic.studies.map((s) => {
        const data = toStudyData(s);
        const eff = data ? computeEffect(data) : null;
        const warns = studyWarnings(s);
        return (
          <div class="card" key={s.id}>
            <div class="grid">
              <Field label="Author"><input value={s.author} onInput={(e) => updateStudy(s.id, { author: val(e) })} /></Field>
              <Field label="Year"><input value={s.year} onInput={(e) => updateStudy(s.id, { year: val(e) })} /></Field>
              <Field label="Design">
                <select value={s.design} onChange={(e) => updateStudy(s.id, { design: val(e) as Design })}>
                  {DESIGNS.map((d) => <option value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Outcome">
                <select value={s.outcomeId} onChange={(e) => updateStudy(s.id, { outcomeId: val(e) })}>
                  {topic.outcomes.map((o) => <option value={o.id}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Dose / regimen"><input value={s.doseRegimen} onInput={(e) => updateStudy(s.id, { doseRegimen: val(e) })} /></Field>
              <Field label="Population"><input value={s.population} onInput={(e) => updateStudy(s.id, { population: val(e) })} /></Field>
            </div>
            <div style="margin-top:.6rem"><Field label="Citation"><input value={s.citation} onInput={(e) => updateStudy(s.id, { citation: val(e) })} /></Field></div>
            <div class="grid" style="margin-top:.6rem">
              <Field label="DOI"><input value={s.doi} onInput={(e) => updateStudy(s.id, { doi: val(e) })} placeholder="10.xxxx/..." /></Field>
              <Field label="URL"><input value={s.url} onInput={(e) => updateStudy(s.id, { url: val(e) })} /></Field>
            </div>

            <div class="row" style="margin-top:.8rem">
              <strong>Effect data:</strong>
              <label class="row" style="text-transform:none"><input type="radio" checked={s.mode === '2x2'} onChange={() => updateStudy(s.id, { mode: '2x2' })} /> 2×2 table</label>
              <label class="row" style="text-transform:none"><input type="radio" checked={s.mode === 'effect'} onChange={() => updateStudy(s.id, { mode: 'effect' })} /> reported effect</label>
            </div>

            {s.mode === '2x2' ? (
              <div class="grid" style="margin-top:.4rem">
                <Field label="Treatment events"><input type="number" value={s.txEvents} onInput={(e) => updateStudy(s.id, { txEvents: val(e) })} /></Field>
                <Field label="Treatment total"><input type="number" value={s.txTotal} onInput={(e) => updateStudy(s.id, { txTotal: val(e) })} /></Field>
                <Field label="Control events"><input type="number" value={s.ctrlEvents} onInput={(e) => updateStudy(s.id, { ctrlEvents: val(e) })} /></Field>
                <Field label="Control total"><input type="number" value={s.ctrlTotal} onInput={(e) => updateStudy(s.id, { ctrlTotal: val(e) })} /></Field>
              </div>
            ) : (
              <div class="grid" style="margin-top:.4rem">
                <Field label="Measure">
                  <select value={s.measure} onChange={(e) => updateStudy(s.id, { measure: val(e) as EffectMeasure })}>
                    <option value="RR">RR</option><option value="OR">OR</option><option value="HR">HR</option>
                  </select>
                </Field>
                <Field label="Point estimate"><input type="number" step="any" value={s.point} onInput={(e) => updateStudy(s.id, { point: val(e) })} /></Field>
                <Field label="CI low"><input type="number" step="any" value={s.ciLow} onInput={(e) => updateStudy(s.id, { ciLow: val(e) })} /></Field>
                <Field label="CI high"><input type="number" step="any" value={s.ciHigh} onInput={(e) => updateStudy(s.id, { ciHigh: val(e) })} /></Field>
                <Field label="Control risk (for NNT)"><input type="number" step="any" value={s.ctrlRisk} onInput={(e) => updateStudy(s.id, { ctrlRisk: val(e) })} placeholder="0.05" /></Field>
              </div>
            )}

            <label class="row" style="text-transform:none;margin-top:.6rem">
              <input type="checkbox" checked={s.excludeFromPooled} onChange={(e) => updateStudy(s.id, { excludeFromPooled: (e.target as HTMLInputElement).checked })} />
              Exclude from pooling (e.g. systematic review)
            </label>

            <div style="margin-top:.6rem">
              <Field label="Notes / interpretation (optional) — shown as a footnote under the study table">
                <textarea rows={2} value={s.notes} onInput={(e) => updateStudy(s.id, { notes: val(e) })}
                  placeholder="e.g. Per-arm counts not reported in the source; entered as the published RR." />
              </Field>
            </div>

            {eff ? (
              <div class="computed">
                <span><span class="k">RR</span> <span class="v">{fmtRR(eff.rr)}</span></span>
                <span><span class="k">95% CI</span> <span class="v">{fmtCI(eff.ciLow, eff.ciHigh)}</span></span>
                <span><span class="k">Improvement</span> <span class="v">{fmtPct(eff.improvementPct)}</span></span>
                <span><span class="k">NNT</span> <span class="v">{eff.nnt !== null ? fmtNN(eff.nnt) : eff.nnh !== null ? `NNH ${eff.nnh}` : '—'}</span></span>
                {eff.continuityCorrected && <span class="k">continuity-corrected</span>}
              </div>
            ) : (
              <div class="computed"><span class="k">Enter valid numbers to compute the effect.</span></div>
            )}
            {warns.map((w) => <div class="warn">⚠ {w}</div>)}

            <div class="row" style="margin-top:.6rem">
              <button class="secondary" onClick={() => duplicateStudy(s.id)}>Duplicate</button>
              <button class="danger" onClick={() => deleteStudy(s.id)}>Delete study</button>
            </div>
          </div>
        );
      })}
      <button class="action" onClick={addStudy}>+ Add study</button>

      {/* ---------------- live pooled preview ---------------- */}
      <div class="card" style="margin-top:1.5rem">
        <h3>Live preview — primary outcome (random-effects pool)</h3>
        {preview ? (
          <div class="computed">
            <span><span class="k">Pooled RR</span> <span class="v">{fmtRR(preview.pooled.rr)}</span></span>
            <span><span class="k">95% CI</span> <span class="v">{fmtCI(preview.pooled.ciLow, preview.pooled.ciHigh)}</span></span>
            <span><span class="k">Improvement</span> <span class="v">{fmtPct(preview.pooled.improvementPct)}</span></span>
            <span><span class="k">Studies</span> <span class="v">{preview.pooled.k}</span></span>
            <span><span class="k">Patients</span> <span class="v">{preview.pooled.totalPatients.toLocaleString()}</span></span>
            <span><span class="k">I²</span> <span class="v">{fmtPct(preview.pooled.i2)}</span></span>
            <span><span class="k">NNT</span> <span class="v">{fmtNN(preview.pooled.nnt)}</span></span>
          </div>
        ) : (
          <p class="muted">Add at least one poolable study on the primary outcome to see the pooled estimate.</p>
        )}
      </div>

      {/* ---------------- import / export ---------------- */}
      <div class="card">
        <h3>Submit &amp; export</h3>
        <div class="row">
          <button class="action" onClick={doEmail}>✉ Email to webmaster</button>
          <button class="secondary" onClick={doExport}>Generate JSON</button>
          <button class="secondary" onClick={doCopy}>{copied ? 'Copied ✓' : 'Copy to clipboard'}</button>
          {exported && (
            <a class="secondary" style="text-decoration:none"
               href={`data:application/json;charset=utf-8,${encodeURIComponent(exported)}`}
               download={`${topic.slug || 'topic'}.json`}>Download {topic.slug || 'topic'}.json</a>
          )}
          <label class="secondary" style="cursor:pointer;text-transform:none">
            Import file<input type="file" accept="application/json,.json" style="display:none" onChange={onFile} />
          </label>
          <button class="danger" onClick={reset}>Clear draft</button>
        </div>
        {exported && <pre class="export">{exported}</pre>}
        <p class="small">
          <strong>Not a developer?</strong> Click <em>Email to webmaster</em> — it opens your mail
          app addressed to {WEBMASTER} with the JSON included (and downloads the file in case you
          need to attach it), and we'll add it to the site.
        </p>
        <p class="small">
          <strong>Contributing directly?</strong> Save the exported file as
          {' '}<code>src/content/topics/{topic.slug || '&lt;slug&gt;'}.json</code> and commit it. The
          build validates it against the schema and generates the topic page automatically.
        </p>
      </div>
    </div>
  );
}

/* ---------- small helpers ---------- */
function val(e: Event): string {
  return (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
}
function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <label>{label}</label>
      {children}
    </div>
  );
}
