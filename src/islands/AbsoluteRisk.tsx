/** @jsxImportSource preact */
import { useState } from 'preact/hooks';
import { absoluteRisk } from '../lib/stats';

interface Preset {
  label: string;
  value: number;
}
interface Props {
  rr: number;
  ciLow: number;
  ciHigh: number;
  direction: 'lowerIsBetter' | 'higherIsBetter';
  baseline: number;
  min: number;
  max: number;
  presets: Preset[];
  outcomeLabel: string;
}

function pct(x: number): string {
  return (x * 100).toFixed(x < 0.01 ? 2 : 1) + '%';
}

/**
 * Interactive absolute-risk translator: a baseline-risk slider that recomputes
 * ARR, NNT/NNH and a 100-person pictograph live, using the same absoluteRisk()
 * the rendered page uses so the numbers always match.
 */
export default function AbsoluteRisk(props: Props) {
  const { rr, ciLow, ciHigh, direction, min, max, presets, outcomeLabel } = props;
  const [baseline, setBaseline] = useState(props.baseline);

  const a = absoluteRisk(baseline, { point: rr, ciLow, ciHigh }, direction);
  const nn = Number.isFinite(a.nn) ? a.nn : null;

  // 100-person icon array: how many of 100 have the event with vs without.
  const withRisk = Math.round(baseline * rr * 100);
  const ctrlRisk = Math.round(baseline * 100);
  const prevented = Math.max(0, ctrlRisk - withRisk); // per 100

  const cells = [];
  for (let i = 0; i < 100; i++) {
    let cls = 'ar-none';
    if (i < withRisk) cls = 'ar-event'; // event on treatment (unavoidable here)
    else if (i < ctrlRisk) cls = 'ar-prevented'; // event prevented by treatment
    cells.push(<span class={`ar-cell ${cls}`} />);
  }

  const rangePct = (baseline - min) / (max - min || 1);

  return (
    <div class="ar">
      <div class="ar-controls">
        <label class="ar-label">
          Baseline risk of {outcomeLabel.toLowerCase()} without treatment:{' '}
          <strong>{pct(baseline)}</strong>
        </label>
        <input
          class="ar-slider"
          type="range"
          min={Math.round(min * 1000)}
          max={Math.round(max * 1000)}
          value={Math.round(baseline * 1000)}
          onInput={(e) => setBaseline((e.currentTarget as HTMLInputElement).valueAsNumber / 1000)}
        />
        {presets.length > 0 && (
          <div class="ar-presets">
            {presets.map((p) => (
              <button
                class={`ar-preset ${Math.abs(p.value - baseline) < 1e-6 ? 'active' : ''}`}
                onClick={() => setBaseline(p.value)}
                type="button"
              >
                {p.label} ({pct(p.value)})
              </button>
            ))}
          </div>
        )}
      </div>

      <div class="ar-outputs">
        <div class="ar-stat">
          <div class="ar-stat-val">{nn ?? '—'}</div>
          <div class="ar-stat-lbl">{a.kind}</div>
        </div>
        <div class="ar-stat">
          <div class="ar-stat-val">{Math.abs(a.per1000.delta).toFixed(0)}</div>
          <div class="ar-stat-lbl">per 1,000 treated ({a.kind === 'NNT' ? 'prevented' : 'caused'})</div>
        </div>
        <div class="ar-stat">
          <div class="ar-stat-val">{pct(Math.abs(a.arr))}</div>
          <div class="ar-stat-lbl">absolute {a.arr >= 0 ? 'reduction' : 'increase'}<br />(95% CI {pct(Math.abs(a.arrLow))}–{pct(Math.abs(a.arrHigh))})</div>
        </div>
      </div>

      <div class="ar-picto" role="img" aria-label={`${prevented} of 100 events prevented`}>
        {cells}
      </div>
      <p class="small ar-legend">
        Of 100 similar patients, <strong>{ctrlRisk}</strong> would have {outcomeLabel.toLowerCase()} without treatment;
        <span class="ar-swatch ar-prevented" /> <strong>{prevented}</strong> {a.kind === 'NNT' ? 'avoided by' : 'affected by'} treatment,
        <span class="ar-swatch ar-event" /> {withRisk} still affected.
        Relative effect held fixed at RR {rr.toFixed(2)}; only baseline risk changes.
      </p>
    </div>
  );
}
