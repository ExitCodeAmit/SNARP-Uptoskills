import CitationGraph from './CitationGraph';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import './CitationNetwork.css';
import './CitationAutomatic.css';

const EMPTY = {
  summary: {
    total_citations: 0,
    cited_papers: 0,
    citing_papers: 0,
  },
  leaders: [],
  recent: [],
  monthly: [],
  network: [],
  myPapers: [],
  discoverable: [],
};

const errorText = (error) =>
  error?.message || 'Something went wrong. Please try again.';

const dateText = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';

const confidenceText = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${Math.round(numeric * 100)}%`;
};

export default function CitationNetwork() {
  const [data, setData] = useState(EMPTY);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [citingPaperId, setCitingPaperId] = useState('');
  const [citedPaperId, setCitedPaperId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Automatic PDF reference scanning and review queue.
  const [scanPaperId, setScanPaperId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [reviewingSuggestionId, setReviewingSuggestionId] = useState('');

  const loadDashboard = useCallback(async (query = '') => {
    try {
      setError('');

      const suffix = query
        ? `?q=${encodeURIComponent(query)}`
        : '';

      const result = await api(`/citations/dashboard${suffix}`);

      setData({
        ...EMPTY,
        ...result,
        summary: {
          ...EMPTY.summary,
          ...(result?.summary || {}),
        },
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    setSuggestionsError('');

    try {
      const result = await api('/citations/suggestions');
      setSuggestions(
        Array.isArray(result?.suggestions) ? result.suggestions : []
      );
    } catch (err) {
      setSuggestions([]);
      setSuggestionsError(errorText(err));
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadSuggestions(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSuggestions]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!search.trim() || search.trim().length >= 2) {
        loadDashboard(search.trim());
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [search, loadDashboard]);

  const maxMonthly = useMemo(
    () =>
      Math.max(
        1,
        ...data.monthly.map(
          (item) => Number(item.citations) || 0
        )
      ),
    [data.monthly]
  );

  const maxLeader = Math.max(
    1,
    ...data.leaders.map(
      (paper) => Number(paper.citation_count) || 0
    )
  );

  const selectedPaper = data.myPapers.find(
    (paper) => String(paper.id) === String(citingPaperId)
  );

  async function registerCitation(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!citingPaperId || !citedPaperId) {
      setError('Select both papers before registering a citation.');
      return;
    }

    if (String(citingPaperId) === String(citedPaperId)) {
      setError('A paper cannot cite itself.');
      return;
    }

    setSubmitting(true);

    try {
      const result = await api('/citations', {
        method: 'POST',
        body: {
          citingPaperId,
          citedPaperId,
        },
      });

      setNotice(
        result?.message || 'Citation registered successfully.'
      );

      setCitingPaperId('');
      setCitedPaperId('');

      await loadDashboard(search.trim());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function scanPaperReferences() {
    setError('');
    setNotice('');

    if (!scanPaperId) {
      setError('Choose one of your published papers to scan.');
      return;
    }

    setScanning(true);

    try {
      const result = await api(
        `/papers/${encodeURIComponent(scanPaperId)}/scan-references`,
        { method: 'POST' }
      );

      setNotice(
        result?.message ||
          `${Number(result?.matchedCount) || 0} possible citation match(es) found.`
      );

      if (Array.isArray(result?.suggestions)) {
        setSuggestions(result.suggestions);
      } else {
        await loadSuggestions();
      }

      await loadDashboard(search.trim());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setScanning(false);
    }
  }

  async function reviewSuggestion(suggestionId, decision) {
    setError('');
    setNotice('');
    setReviewingSuggestionId(String(suggestionId));

    try {
      const result = await api(
        `/citations/suggestions/${encodeURIComponent(suggestionId)}/${decision}`,
        { method: 'POST' }
      );

      setNotice(
        result?.message ||
          (decision === 'accept'
            ? 'Citation suggestion accepted.'
            : 'Citation suggestion dismissed.')
      );

      await Promise.all([
        loadSuggestions(),
        loadDashboard(search.trim()),
      ]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setReviewingSuggestionId('');
    }
  }

  function refresh() {
    setRefreshing(true);
    loadDashboard(search.trim());
    loadSuggestions();
  }

  if (loading) {
    return (
      <main className="citation-page">
        <div className="citation-loading">
          <span className="citation-spinner" />
          Loading citation network…
        </div>
      </main>
    );
  }

  return (
    <main className="citation-page">
      {/* Header */}
      <header className="citation-hero">
        <div>
          <div className="citation-eyebrow">RESEARCH ANALYTICS</div>
          <h1>Citation Network</h1>
          <p>
            Explore how research papers connect and discover
            work influencing your field.
          </p>
        </div>

        <button
          className="citation-refresh"
          onClick={refresh}
          disabled={refreshing}
          type="button"
        >
          ↻ {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {/* Alerts */}
      {error && (
        <div className="citation-alert citation-alert-error" role="alert">
          {error}
        </div>
      )}

      {notice && (
        <div className="citation-alert citation-alert-success" role="status">
          {notice}
        </div>
      )}

      {/* Automatic PDF citation detection */}
      <section className="citation-auto-layout">
        <article className="citation-panel citation-auto-panel">
          <div className="citation-panel-heading">
            <div>
              <span className="citation-kicker">AI-ASSISTED REFERENCE CHECK</span>
              <h2>Scan PDF references</h2>
            </div>
            <span className="citation-heading-icon">⌕</span>
          </div>

          <p className="citation-muted">
            Select one of your published papers. SNARP will read its PDF
            reference section and look for matching published papers already
            stored in the platform.
          </p>

          <div className="citation-auto-scan-row">
            <label className="citation-auto-field" htmlFor="scan-reference-paper">
              Paper to scan
              <select
                id="scan-reference-paper"
                value={scanPaperId}
                onChange={(event) => setScanPaperId(event.target.value)}
                disabled={!data.myPapers.length || scanning}
              >
                <option value="">Choose one of your published papers</option>
                {data.myPapers.map((paper) => (
                  <option key={paper.id} value={paper.id}>
                    {paper.title}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="citation-primary-button citation-auto-scan-button"
              type="button"
              onClick={scanPaperReferences}
              disabled={!scanPaperId || scanning || !data.myPapers.length}
            >
              {scanning ? 'Scanning PDF…' : 'Scan PDF references'}
            </button>
          </div>

          {!data.myPapers.length && (
            <small className="citation-empty-hint">
              You need an published paper with an uploaded PDF before scanning.
            </small>
          )}

          <p className="citation-auto-note">
            Matches are suggestions, not confirmed citations. Review each
            result before accepting it. Image-only scanned PDFs are not
            supported by this text-based scan.
          </p>
        </article>

        <article className="citation-panel citation-auto-panel">
          <div className="citation-panel-heading">
            <div>
              <span className="citation-kicker">AUTHOR REVIEW REQUIRED</span>
              <h2>Detected citation suggestions</h2>
            </div>
            <span className="citation-auto-count">{suggestions.length}</span>
          </div>

          {suggestionsError && (
            <div className="citation-alert citation-alert-error" role="alert">
              {suggestionsError}
            </div>
          )}

          {suggestionsLoading ? (
            <div className="citation-empty">Loading suggestions…</div>
          ) : suggestions.length ? (
            <div className="citation-suggestion-list">
              {suggestions.map((suggestion) => {
                const isReviewing =
                  reviewingSuggestionId === String(suggestion.id);

                return (
                  <article
                    className="citation-suggestion"
                    key={suggestion.id}
                  >
                    <div className="citation-suggestion-topline">
                      <span className="citation-suggestion-type">
                        {String(suggestion.match_type || 'match').toUpperCase()} MATCH
                      </span>
                      <span className="citation-suggestion-confidence">
                        Confidence: {confidenceText(suggestion.confidence)}
                      </span>
                    </div>

                    <div className="citation-suggestion-flow">
                      <div>
                        <small>Citing paper</small>
                        <strong>{suggestion.citing_title}</strong>
                      </div>
                      <span aria-hidden="true">→</span>
                      <div>
                        <small>Possible cited paper</small>
                        <strong>{suggestion.cited_title}</strong>
                      </div>
                    </div>

                    {suggestion.evidence_text && (
                      <blockquote className="citation-suggestion-evidence">
                        {suggestion.evidence_text}
                      </blockquote>
                    )}

                    <div className="citation-suggestion-actions">
                      <button
                        type="button"
                        className="citation-suggestion-accept"
                        onClick={() => reviewSuggestion(suggestion.id, 'accept')}
                        disabled={isReviewing}
                      >
                        {isReviewing ? 'Saving…' : 'Accept citation'}
                      </button>
                      <button
                        type="button"
                        className="citation-suggestion-dismiss"
                        onClick={() => reviewSuggestion(suggestion.id, 'dismiss')}
                        disabled={isReviewing}
                      >
                        Dismiss
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="citation-empty">
              No pending suggestions. Scan an published PDF to look for references.
            </div>
          )}
        </article>
      </section>

      {/* Statistics */}
      <section className="citation-stats">
        <article className="citation-stat-card">
          <div className="citation-stat-icon purple">↗</div>
          <div>
            <span>Total citations</span>
            <strong>
              {Number(data.summary.total_citations || 0).toLocaleString()}
            </strong>
            <small>Registered on SNARP</small>
          </div>
        </article>

        <article className="citation-stat-card">
          <div className="citation-stat-icon blue">▤</div>
          <div>
            <span>Cited papers</span>
            <strong>
              {Number(data.summary.cited_papers || 0).toLocaleString()}
            </strong>
            <small>Research papers referenced</small>
          </div>
        </article>

        <article className="citation-stat-card">
          <div className="citation-stat-icon green">⌁</div>
          <div>
            <span>Citing papers</span>
            <strong>
              {Number(data.summary.citing_papers || 0).toLocaleString()}
            </strong>
            <small>Papers contributing citations</small>
          </div>
        </article>
      </section>

      {/* Main section */}
      <section className="citation-main-grid">
        {/* Register citation manually */}
        <article className="citation-panel">
          <div className="citation-panel-heading">
            <div>
              <span className="citation-kicker">CONTRIBUTE TO THE NETWORK</span>
              <h2>Register a citation</h2>
            </div>
            <span className="citation-heading-icon">＋</span>
          </div>

          <p className="citation-muted">
            Connect one of your published papers to another
            published research paper.
          </p>

          <form className="citation-form" onSubmit={registerCitation}>
            <label htmlFor="citing-paper">Your paper (citing paper)</label>
            <select
              id="citing-paper"
              value={citingPaperId}
              onChange={(e) => setCitingPaperId(e.target.value)}
              required
            >
              <option value="">Choose one of your published papers</option>
              {data.myPapers.map((paper) => (
                <option key={paper.id} value={paper.id}>
                  {paper.title}
                </option>
              ))}
            </select>

            <label htmlFor="cited-paper">Paper being cited</label>
            <select
              id="cited-paper"
              value={citedPaperId}
              onChange={(e) => setCitedPaperId(e.target.value)}
              required
            >
              <option value="">Choose a research paper</option>
              {data.discoverable
                .filter((paper) => String(paper.id) !== String(citingPaperId))
                .map((paper) => (
                  <option key={paper.id} value={paper.id}>
                    {paper.title}
                    {paper.domain ? ` — ${paper.domain}` : ''}
                  </option>
                ))}
            </select>

            <div className="citation-form-note">
              {selectedPaper
                ? `Citing from: ${selectedPaper.title}`
                : 'Only your own published papers can be selected as the citing paper.'}
            </div>

            <button
              className="citation-primary-button"
              type="submit"
              disabled={
                submitting ||
                !data.myPapers.length ||
                !data.discoverable.length
              }
            >
              {submitting ? 'Registering…' : '＋ Register citation'}
            </button>

            {!data.myPapers.length && (
              <small className="citation-empty-hint">
                You need an published paper of your own to register a citation.
              </small>
            )}
          </form>
        </article>

        {/* Most cited papers */}
        <article className="citation-panel">
          <div className="citation-panel-heading">
            <div>
              <span className="citation-kicker">RESEARCH DISCOVERY</span>
              <h2>Most cited papers</h2>
            </div>
            <span className="citation-heading-icon">★</span>
          </div>

          {data.leaders.length ? (
            <div className="citation-leader-list">
              {data.leaders.map((paper, index) => {
                const count = Number(paper.citation_count) || 0;

                return (
                  <div className="citation-leader" key={paper.id}>
                    <span className="citation-rank">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="citation-leader-content">
                      <div className="citation-leader-title">{paper.title}</div>
                      <div className="citation-progress">
                        <span
                          style={{ width: `${(count / maxLeader) * 100}%` }}
                        />
                      </div>
                    </div>
                    <strong>{count}</strong>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="citation-empty">No citation data available yet.</div>
          )}
        </article>
      </section>

      {/* Citation network graph */}
      <CitationGraph edges={data.network} />

      {/* Monthly activity */}
      <section className="citation-panel citation-trend-panel">
        <div className="citation-panel-heading citation-trend-heading">
          <div>
            <span className="citation-kicker">LAST SIX MONTHS</span>
            <h2>Citation activity</h2>
          </div>
          <span className="citation-muted">Monthly registered citations</span>
        </div>

        {data.monthly.length ? (
          <div
            className="citation-chart"
            role="img"
            aria-label="Monthly citation activity bar chart"
          >
            {data.monthly.map((item) => {
              const value = Number(item.citations) || 0;

              return (
                <div className="citation-chart-column" key={item.month}>
                  <strong>{value}</strong>
                  <div className="citation-chart-track">
                    <span
                      style={{
                        height: `${Math.max(5, (value / maxMonthly) * 100)}%`,
                      }}
                    />
                  </div>
                  <small>{item.month}</small>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="citation-empty">
            Citation activity will appear here when citations are registered.
          </div>
        )}
      </section>

      {/* Recent citations */}
      <section className="citation-panel citation-recent-panel">
        <div className="citation-panel-heading citation-recent-heading">
          <div>
            <span className="citation-kicker">LATEST CONNECTIONS</span>
            <h2>Recent citations</h2>
          </div>
          <div className="citation-search-wrap">
            <span>⌕</span>
            <input
              type="search"
              placeholder="Search papers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search research papers"
            />
          </div>
        </div>

        {data.recent.length ? (
          <div className="citation-table-wrap">
            <table className="citation-table">
              <thead>
                <tr>
                  <th>Citing paper</th>
                  <th></th>
                  <th>Cited paper</th>
                  <th>Date added</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="citation-paper-cell">
                        {item.citing_title}
                      </span>
                    </td>
                    <td><span className="citation-arrow">→</span></td>
                    <td>
                      <span className="citation-paper-cell">
                        {item.cited_title}
                      </span>
                    </td>
                    <td className="citation-date">
                      {dateText(item.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="citation-empty">No matching citations found.</div>
        )}
      </section>

      <p className="citation-disclaimer">
        Citation metrics represent citations registered within SNARP.
        They are not global citation counts from Google Scholar,
        Scopus, or other indexing services. PDF matches remain suggestions
        until an author accepts them.
      </p>
    </main>
  );
}
