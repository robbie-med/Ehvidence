/** @jsxImportSource preact */
import { useEffect, useRef, useState } from 'preact/hooks';
import { searchDocs, type SearchDoc } from '../lib/searchIndex';

interface Props {
  /** Site base path (import.meta.env.BASE_URL from the host .astro). */
  base?: string;
  /** 'nav' = compact header box; 'hero' = large homepage box. */
  variant?: 'nav' | 'hero';
  placeholder?: string;
}

const STATUS_LABEL: Record<string, string> = {
  favorable: 'Favorable',
  harmful: 'Harmful',
  limited: 'Limited',
  neutral: 'Inconclusive',
};

/**
 * Site search island. Fetches the static /search-index.json once, then ranks
 * client-side with the same pure scorer used to build it. Keyboard: ArrowUp/
 * Down to move, Enter to open, Escape to clear.
 */
export default function SearchBox({ base = '', variant = 'nav', placeholder }: Props) {
  const root = base.replace(/\/$/, '');
  const [docs, setDocs] = useState<SearchDoc[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Load the index lazily on first focus so it never blocks page paint.
  const [loaded, setLoaded] = useState(false);
  function ensureIndex() {
    if (loaded) return;
    setLoaded(true);
    fetch(`${root}/search-index.json`)
      .then((r) => (r.ok ? r.json() : { docs: [] }))
      .then((data) => setDocs(data.docs ?? []))
      .catch(() => setDocs([]));
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const results = query ? searchDocs(docs, query, 8) : [];

  function go(doc: SearchDoc) {
    window.location.href = doc.url;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (results[active]) go(results[active]);
    } else if (e.key === 'Escape') {
      setQuery('');
      setOpen(false);
    }
  }

  const showResults = open && query.length > 0;

  return (
    <div class={`search search-${variant}`} ref={boxRef}>
      <input
        type="search"
        role="combobox"
        aria-expanded={showResults}
        aria-controls="search-results"
        autocomplete="off"
        placeholder={placeholder ?? 'Search topics, conditions, interventions…'}
        value={query}
        onFocus={() => {
          ensureIndex();
          setOpen(true);
        }}
        onInput={(e) => {
          setQuery((e.target as HTMLInputElement).value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {showResults && (
        <ul class="search-results" id="search-results" role="listbox">
          {results.length === 0 ? (
            <li class="search-empty">No matching topics.</li>
          ) : (
            results.map((doc, i) => (
              <li
                key={doc.slug}
                role="option"
                aria-selected={i === active}
                class={i === active ? 'is-active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(doc);
                }}
              >
                <span class="sr-name">{doc.name}</span>
                <span class={`badge ${doc.status}`}>{STATUS_LABEL[doc.status] ?? doc.status}</span>
                <span class="sr-cat">{doc.category}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
