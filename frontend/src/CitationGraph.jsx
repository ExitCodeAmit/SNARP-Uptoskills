
import { useMemo, useState } from 'react';
import './CitationGraph.css';

export default function CitationGraph({ edges = [] }) {
  const [selectedPaperId, setSelectedPaperId] = useState('');

  const graph = useMemo(() => {
    const paperMap = new Map();
    const links = [];

    const getPaper = (id, title) => {
      const key = String(id);

      if (!paperMap.has(key)) {
        paperMap.set(key, {
          id: key,
          title: title || 'Untitled paper',
          incoming: 0,
          outgoing: 0,
          x: 0,
          y: 0,
        });
      }

      return paperMap.get(key);
    };

    (Array.isArray(edges) ? edges : []).forEach((edge) => {
      const sourceId = String(edge.citing_paper_id ?? '');
      const targetId = String(edge.cited_paper_id ?? '');

      if (!sourceId || !targetId || sourceId === targetId) return;

      const source = getPaper(sourceId, edge.citing_title);
      const target = getPaper(targetId, edge.cited_title);

      source.outgoing += 1;
      target.incoming += 1;

      links.push({
        id: String(edge.id ?? `${sourceId}-${targetId}`),
        sourceId,
        targetId,
      });
    });

    // Place highly connected papers first.
    const nodes = [...paperMap.values()].sort(
      (a, b) =>
        (b.incoming + b.outgoing) -
        (a.incoming + a.outgoing)
    );

    // Arrange papers in concentric rings.
    let cursor = 0;
    let ring = 0;

    while (cursor < nodes.length) {
      const capacity = 10 + ring * 8;
      const ringNodes = nodes.slice(cursor, cursor + capacity);
      const radius = 80 + ring * 78;

      ringNodes.forEach((node, index) => {
        const angle =
          (2 * Math.PI * index / ringNodes.length) -
          Math.PI / 2;

        node.x = 550 + radius * Math.cos(angle);
        node.y = 450 + radius * Math.sin(angle);
      });

      cursor += ringNodes.length;
      ring += 1;
    }

    const positionedLinks = links
      .map((link) => ({
        ...link,
        source: paperMap.get(link.sourceId),
        target: paperMap.get(link.targetId),
      }))
      .filter((link) => link.source && link.target);

    return {
      nodes,
      links: positionedLinks,
    };
  }, [edges]);

  const selectedPaper = graph.nodes.find(
    (node) => node.id === selectedPaperId
  );

  const selectedConnections = graph.links.filter(
    (link) =>
      link.sourceId === selectedPaperId ||
      link.targetId === selectedPaperId
  );

  return (
    <section className="citation-panel citation-graph-panel">
      <div className="citation-panel-heading">
        <div>
          <span className="citation-kicker">
            RESEARCH RELATIONSHIPS
          </span>
          <h2>Citation Network Graph</h2>
        </div>

        <span className="citation-graph-count">
          {graph.nodes.length} papers · {graph.links.length} links
        </span>
      </div>

      {graph.nodes.length === 0 ? (
        <div className="citation-graph-empty">
          <div className="citation-graph-empty-icon">◎</div>
          <strong>No citation connections yet</strong>
          <p>
            When approved research papers are connected
            through registered citations, their relationships
            will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="citation-graph-viewport">
            <svg
              className="citation-graph-svg"
              viewBox="0 0 1100 900"
              role="img"
              aria-label="Interactive research paper citation network"
            >
              <defs>
                <marker
                  id="citation-network-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path
                    d="M0,0 L8,4 L0,8 Z"
                    fill="#9284dd"
                  />
                </marker>
              </defs>

              {/* Citation connections */}
              {graph.links.map((link) => {
                const dx = link.target.x - link.source.x;
                const dy = link.target.y - link.source.y;
                const distance = Math.hypot(dx, dy);

                if (!distance) return null;

                const ux = dx / distance;
                const uy = dy / distance;
                const offset = 24;

                return (
                  <line
                    key={link.id}
                    className="citation-graph-edge"
                    x1={link.source.x + ux * offset}
                    y1={link.source.y + uy * offset}
                    x2={link.target.x - ux * offset}
                    y2={link.target.y - uy * offset}
                    markerEnd="url(#citation-network-arrow)"
                  />
                );
              })}

              {/* Research paper nodes */}
              {graph.nodes.map((node, index) => {
                const selected = selectedPaperId === node.id;

                const nodeType =
                  node.incoming && node.outgoing
                    ? 'citation-node-connected'
                    : node.outgoing
                      ? 'citation-node-citing'
                      : 'citation-node-cited';

                return (
                  <g
                    key={node.id}
                    className={`citation-graph-node ${nodeType} ${
                      selected ? 'selected' : ''
                    }`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.title}. Cited ${node.incoming} times and cites ${node.outgoing} papers.`}
                    aria-pressed={selected}
                    onClick={() => setSelectedPaperId(node.id)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' ||
                        event.key === ' '
                      ) {
                        event.preventDefault();
                        setSelectedPaperId(node.id);
                      }
                    }}
                  >
                    <title>
                      {node.title}
                      {' | Cited by: '}
                      {node.incoming}
                      {' | Cites: '}
                      {node.outgoing}
                    </title>

                    <circle
                      cx={node.x}
                      cy={node.y}
                      r="22"
                    />

                    <text
                      x={node.x}
                      y={node.y + 4}
                      textAnchor="middle"
                    >
                      {String(index + 1).padStart(2, '0')}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="citation-graph-legend">
            <span>
              <i className="legend-citing" />
              Citing paper
            </span>
            <span>
              <i className="legend-cited" />
              Cited paper
            </span>
            <span>
              <i className="legend-connected" />
              Connected paper
            </span>
          </div>

          {selectedPaper && (
            <div className="citation-graph-inspector">
              <div>
                <span className="citation-kicker">
                  SELECTED RESEARCH PAPER
                </span>

                <h3>{selectedPaper.title}</h3>

                <p>
                  Cited by {selectedPaper.incoming} papers
                  {' · '}
                  Cites {selectedPaper.outgoing} papers
                </p>
              </div>

              <div className="citation-graph-connections">
                {selectedConnections.map((link) => (
                  <div key={link.id}>
                    {link.sourceId === selectedPaperId
                      ? `Cites → ${link.target.title}`
                      : `Cited by ← ${link.source.title}`}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
