import { useEffect, useMemo, useState } from 'react';
import { auth, api } from '@appdeploy/client';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  BookMarked,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Cloud,
  Command,
  Database,
  Dna,
  ExternalLink,
  FilePlus2,
  FileText,
  Filter,
  GitBranch,
  Globe2,
  Hexagon,
  Layers3,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import './atlas.css';

type Kind = 'source' | 'claim' | 'hypothesis' | 'edge';
type View = 'overview' | 'library' | 'claims' | 'graph' | 'hypotheses';
type AuthUser = { userId: string; name?: string; email?: string };
type RecordItem = {
  id: string;
  kind: Kind;
  title: string;
  summary: string;
  authors: string;
  doi: string;
  url: string;
  year: string;
  tags: string;
  confidence: number;
  quality: string;
  status: string;
  relation: string;
  from: string;
  to: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  provenance: string;
};
type RecordForm = Omit<
  RecordItem,
  'id' | 'createdAt' | 'updatedAt' | 'provenance'
>;
const seedForm = (kind: Kind): RecordForm => ({
  kind,
  title: '',
  summary: '',
  authors: '',
  doi: '',
  url: '',
  year: '',
  tags: '',
  confidence: 50,
  quality: 'unassessed',
  status: 'open',
  relation: 'supports',
  from: '',
  to: '',
  filePath: '',
});
const navItems: { view: View; label: string; icon: typeof BookOpen }[] = [
  { view: 'overview', label: 'Overview', icon: Layers3 },
  { view: 'library', label: 'Research library', icon: BookOpen },
  { view: 'claims', label: 'Claims & evidence', icon: ShieldCheck },
  { view: 'graph', label: 'Knowledge graph', icon: Network },
  { view: 'hypotheses', label: 'Hypotheses', icon: Dna },
];
const kindLabels: Record<Kind, string> = {
  source: 'Source',
  claim: 'Claim',
  hypothesis: 'Hypothesis',
  edge: 'Relationship',
};
const colors: Record<Kind, string> = {
  source: '#82bdf6',
  claim: '#b29afa',
  hypothesis: '#51d3ad',
  edge: '#e6b97f',
};
const shortDate = (date?: string) =>
  date
    ? new Date(date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';
function escapeCsv(value: unknown) {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}
function downloadFile(filename: string, content: string, type: string) {
  const objectUrl = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
}
function IconBadge({ kind }: { kind: Kind }) {
  return <span className={'kind-pill kind-' + kind}>{kindLabels[kind]}</span>;
}

function GraphCanvas({
  records,
  onSelect,
  compact = false,
}: {
  records: RecordItem[];
  onSelect: (item: RecordItem) => void;
  compact?: boolean;
}) {
  const nodes = records
    .filter(r => r.kind !== 'edge')
    .slice(0, compact ? 18 : 70);
  const edgeRecords = records.filter(r => r.kind === 'edge');
  const coordinates = new Map(
    nodes.map((node, i) => {
      const angle = i * 2.39996;
      const radius =
        Math.sqrt((i + 0.7) / Math.max(nodes.length, 1)) *
        (compact ? 172 : 189);
      return [
        node.id,
        {
          x: 370 + Math.cos(angle) * radius,
          y: 216 + Math.sin(angle) * radius,
        },
      ];
    })
  );
  return (
    <div className={'graph-wrap ' + (compact ? 'graph-compact' : '')}>
      {nodes.length === 0 ? (
        <div className="graph-empty">
          <Network size={34} />
          <strong>No connected knowledge yet</strong>
          <span>
            Add a source, claim, or hypothesis to start building your map.
          </span>
        </div>
      ) : (
        <svg
          className="graph-svg"
          viewBox="0 0 740 440"
          role="img"
          aria-label="Interactive research graph"
        >
          <defs>
            <pattern
              id="atlas-dots"
              width="26"
              height="26"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="1" fill="#263a4a" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="740" height="440" fill="url(#atlas-dots)" />
          {edgeRecords.map(edge => {
            const a = coordinates.get(edge.from);
            const b = coordinates.get(edge.to);
            if (!a || !b) return null;
            return (
              <g key={edge.id}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={
                    edge.relation === 'contradicts' ? '#de877d' : '#647d97'
                  }
                  strokeWidth="1.8"
                  strokeOpacity=".65"
                  strokeDasharray={
                    edge.relation === 'contradicts' ? '5 5' : undefined
                  }
                />
              </g>
            );
          })}
          {nodes.map(node => {
            const p = coordinates.get(node.id)!;
            const label =
              node.title.length > 25
                ? node.title.slice(0, 22) + '…'
                : node.title;
            return (
              <g
                key={node.id}
                className="graph-node"
                onClick={() => onSelect(node)}
                tabIndex={0}
                role="button"
                aria-label={'Open ' + node.title}
                onKeyDown={e => {
                  if (e.key === 'Enter') onSelect(node);
                }}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={compact ? 10 : 12}
                  fill="#0c1725"
                  stroke={colors[node.kind]}
                  strokeWidth="2"
                />
                <circle cx={p.x} cy={p.y} r="4.5" fill={colors[node.kind]} />
                {!compact && (
                  <text
                    x={p.x}
                    y={p.y + 28}
                    textAnchor="middle"
                    fill="#d9e4ee"
                    fontSize="11"
                    fontWeight="500"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <div className="graph-legend">
        <span>
          <i style={{ background: colors.source }} />
          Sources
        </span>
        <span>
          <i style={{ background: colors.claim }} />
          Claims
        </span>
        <span>
          <i style={{ background: colors.hypothesis }} />
          Hypotheses
        </span>
      </div>
    </div>
  );
}

export default function AtlasApp() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [view, setView] = useState<View>('overview');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Kind | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<RecordForm>(seedForm('source'));
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [detail, setDetail] = useState<RecordItem | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    auth
      .getUser()
      .then(u => setUser(u))
      .catch(() => {})
      .finally(() => setAuthChecking(false));
  }, []);
  useEffect(() => {
    if (user) void loadRecords();
    else setRecords([]);
  }, [user?.userId]);
  async function loadRecords(next?: string) {
    setLoading(true);
    try {
      const result = await api.get(
        '/api/records' + (next ? '?cursor=' + encodeURIComponent(next) : '')
      );
      const nextRecords = result.data.records as RecordItem[];
      setRecords(old => (next ? [...old, ...nextRecords] : nextRecords));
      setCursor(result.data.nextToken || null);
      setNotice('');
    } catch (err) {
      setNotice(
        'Unable to load your workspace. Check your connection and try Refresh.'
      );
    } finally {
      setLoading(false);
    }
  }
  async function signIn() {
    setSigningIn(true);
    setNotice('');
    try {
      const result = await auth.signIn();
      setUser(result.user);
    } catch (err) {
      const code = (err as { code?: string }).code;
      setNotice(
        code === 'popup_blocked'
          ? 'Allow popups for this site to sign in.'
          : code === 'popup_closed'
            ? 'Sign-in was cancelled.'
            : 'Sign-in could not be completed.'
      );
    } finally {
      setSigningIn(false);
    }
  }
  async function signOut() {
    await auth.signOut();
    setUser(null);
    setDetail(null);
    setView('overview');
  }
  const sources = records.filter(r => r.kind === 'source');
  const claims = records.filter(r => r.kind === 'claim');
  const hypotheses = records.filter(r => r.kind === 'hypothesis');
  const edges = records.filter(r => r.kind === 'edge');
  const nodes = records.filter(r => r.kind !== 'edge');
  const filtered = useMemo(() => {
    const subset = records.filter(r =>
      view === 'library'
        ? r.kind === 'source'
        : view === 'claims'
          ? r.kind === 'claim'
          : view === 'hypotheses'
            ? r.kind === 'hypothesis'
            : r.kind !== 'edge'
    );
    const q = search.toLowerCase().trim();
    return subset
      .filter(
        r =>
          !q ||
          [r.title, r.summary, r.tags, r.authors, r.doi]
            .join(' ')
            .toLowerCase()
            .includes(q)
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [records, view, search]);
  const activeEdges = detail
    ? edges.filter(e => e.from === detail.id || e.to === detail.id)
    : [];
  function openCreate(kind: Kind) {
    setModal(kind);
    setEditing(null);
    setForm(seedForm(kind));
    setFormError('');
    setFile(null);
  }
  function openEdit(r: RecordItem) {
    setEditing(r.id);
    setModal(r.kind);
    setForm({
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      authors: r.authors || '',
      doi: r.doi || '',
      url: r.url || '',
      year: r.year || '',
      tags: r.tags || '',
      confidence: r.confidence ?? 50,
      quality: r.quality || 'unassessed',
      status: r.status || 'open',
      relation: r.relation || 'supports',
      from: r.from || '',
      to: r.to || '',
      filePath: r.filePath || '',
    });
    setDetail(null);
    setFormError('');
    setFile(null);
  }
  async function saveRecord(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    if (!form.title.trim()) {
      setFormError('A title is required.');
      return;
    }
    if (
      form.kind === 'edge' &&
      (!form.from || !form.to || form.from === form.to)
    ) {
      setFormError('Select two different research nodes.');
      return;
    }
    if (form.url && !form.url.startsWith('https://')) {
      setFormError('Source URLs must begin with https://');
      return;
    }
    setSaving(true);
    const id = editing || crypto.randomUUID();
    try {
      let filePath = form.filePath;
      if (file && !editing) {
        if (file.size > 1000000 || file.type !== 'application/pdf')
          throw new Error('Choose a PDF under 1 MB.');
        const encoded = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = () => reject(new Error('Could not read PDF'));
          reader.readAsDataURL(file);
        });
        const uploaded = await api.post('/api/files', {
          id,
          content: encoded,
          contentType: 'application/pdf',
        });
        filePath = uploaded.data.filePath;
      }
      const body = { ...form, title: form.title.trim(), filePath, id };
      const result = editing
        ? await api.put('/api/records/' + id, body)
        : await api.post('/api/records', body);
      const saved = result.data.record as RecordItem;
      setRecords(previous => [
        saved,
        ...previous.filter(r => r.id !== saved.id),
      ]);
      setModal(null);
      setEditing(null);
      setSearch('');
      setNotice('');
      if (saved.kind === 'edge') setView('graph');
      else if (saved.kind === 'source') setView('library');
      else if (saved.kind === 'claim') setView('claims');
      else setView('hypotheses');
    } catch (err) {
      const e = err as {
        response?: { data?: { error?: string; message?: string } };
        message?: string;
      };
      setFormError(
        e.response?.data?.error ||
          e.response?.data?.message ||
          e.message ||
          'Could not save. Try again.'
      );
    } finally {
      setSaving(false);
    }
  }
  async function deleteRecord(r: RecordItem) {
    if (
      !window.confirm(
        'Delete "' +
          r.title +
          '"? Associated graph links will also be removed. This cannot be undone.'
      )
    )
      return;
    try {
      await api.delete('/api/records/' + r.id);
      setRecords(prev =>
        prev.filter(
          item =>
            item.id !== r.id &&
            !(item.kind === 'edge' && (item.from === r.id || item.to === r.id))
        )
      );
      setDetail(null);
      setNotice('Record deleted.');
    } catch (err) {
      setNotice('Deletion failed. Try again.');
    }
  }
  async function openAttachment(r: RecordItem) {
    try {
      const response = await api.get('/api/file-url/' + r.id);
      if (response.data.url)
        window.open(response.data.url, '_blank', 'noopener,noreferrer');
      else setNotice('Attachment is unavailable.');
    } catch (err) {
      setNotice('Could not access the attachment.');
    }
  }
  function exportData(format: 'json' | 'csv') {
    if (format === 'json')
      downloadFile(
        'evidence-atlas-export.json',
        JSON.stringify(
          { exportedAt: new Date().toISOString(), version: 1, records },
          null,
          2
        ),
        'application/json'
      );
    else {
      const keys: (keyof RecordItem)[] = [
        'id',
        'kind',
        'title',
        'summary',
        'authors',
        'doi',
        'url',
        'year',
        'tags',
        'confidence',
        'quality',
        'status',
        'relation',
        'from',
        'to',
        'createdAt',
        'updatedAt',
        'provenance',
      ];
      downloadFile(
        'evidence-atlas-export.csv',
        [
          keys.join(','),
          ...records.map(r => keys.map(key => escapeCsv(r[key])).join(',')),
        ].join('\n'),
        'text/csv;charset=utf-8'
      );
    }
  }
  const pageTitle: Record<View, string> = {
    overview: 'Research overview',
    library: 'Research library',
    claims: 'Claims & evidence',
    graph: 'Knowledge graph',
    hypotheses: 'Hypothesis lab',
  };
  if (authChecking)
    return (
      <div className="auth-screen">
        <div className="loading-ring" />
        <p>Initializing Evidence Atlas…</p>
      </div>
    );
  if (!user)
    return (
      <div className="auth-screen">
        <div className="auth-grid" />
        <div className="auth-card">
          <div className="brand-mark large">
            <Hexagon size={30} />
            <span className="brand-center">✦</span>
          </div>
          <span className="eyebrow">YOUR PRIVATE RESEARCH WORKSPACE</span>
          <h1>
            Knowledge is a network.
            <br />
            <em>Make it navigable.</em>
          </h1>
          <p>
            Organize sources, map evidence, challenge hypotheses, and trace
            every claim back to its origin.
          </p>
          <button
            className="primary-button auth-button"
            disabled={signingIn}
            onClick={signIn}
          >
            {signingIn ? 'Opening sign-in…' : 'Sign in to your workspace'}
            <ArrowRight size={17} />
          </button>
          {notice && <p className="error-banner">{notice}</p>}
          <div className="auth-benefits">
            <span>
              <LockKeyhole size={14} /> Private by account
            </span>
            <span>
              <Database size={14} /> Persistent research
            </span>
            <span>
              <Network size={14} /> Evidence graphs
            </span>
          </div>
          <small>
            Start with your own sources. No invented citations, papers, or AI
            conclusions.
          </small>
        </div>
        <div className="auth-footer">
          EVIDENCE ATLAS <span>RESEARCH SYSTEMS / V1.0</span>
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (menuOpen ? 'sidebar-visible' : '')}>
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Hexagon size={23} />
            <span className="brand-center">✦</span>
          </div>
          <div>
            <strong>Evidence Atlas</strong>
            <small>RESEARCH OS · 1.0</small>
          </div>
        </div>
        <div className="workspace-select">
          <div className="workspace-avatar">R</div>
          <div>
            <strong>My research</strong>
            <span>Private workspace</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="nav-list">
          {navItems.map(nav => (
            <button
              key={nav.view}
              className={'nav-item ' + (view === nav.view ? 'active' : '')}
              onClick={() => {
                setView(nav.view);
                setSearch('');
                setMenuOpen(false);
              }}
            >
              <nav.icon size={17} />
              {nav.label}
              {nav.view === 'library' && sources.length > 0 && (
                <span className="nav-count">{sources.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-filler" />
        <div className="sidebar-info">
          <div className="tiny-green-dot" />
          WORKSPACE SYNCED
          <span>
            <Cloud size={14} />
          </span>
        </div>
        <button className="profile-row" onClick={signOut} title="Sign out">
          <div className="profile-avatar">
            {(user.name || user.email || 'R').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{user.name || 'Researcher'}</strong>
            <span>{user.email || 'Signed in'}</span>
          </div>
          <LogOut size={16} />
        </button>
      </aside>
      {menuOpen && (
        <div className="mobile-shade" onClick={() => setMenuOpen(false)} />
      )}
      <main className="main-area">
        <header className="topbar">
          <div className="top-left">
            <button
              className="mobile-menu"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={21} />
            </button>
            <span className="top-breadcrumb">Workspace</span>
            <ChevronRight size={15} />
            <strong>{pageTitle[view]}</strong>
          </div>
          <div className="top-actions">
            <span className="private-label">
              <LockKeyhole size={13} /> PRIVATE
            </span>
            <button
              className="icon-btn"
              title="Export JSON"
              onClick={() => exportData('json')}
            >
              <ArrowDownToLine size={18} />
            </button>
            <button
              className="primary-button top-create"
              onClick={() => openCreate('source')}
            >
              <Plus size={17} /> New source
            </button>
          </div>
        </header>
        <div className="content-area">
          {notice && (
            <div className="notice-banner">
              <span>{notice}</span>
              <button
                onClick={() => {
                  setNotice('');
                  void loadRecords();
                }}
              >
                Refresh <ArrowRight size={14} />
              </button>
              <button aria-label="Dismiss" onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {view === 'overview' && (
            <>
              <div className="overview-heading">
                <div>
                  <span className="eyebrow">THE RESEARCH WORKSPACE</span>
                  <h1>
                    Good morning,{' '}
                    <span>{(user.name || 'researcher').split(' ')[0]}.</span>
                  </h1>
                  <p>
                    Explore the connections. Question the conclusions. Follow
                    the evidence.
                  </p>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => setView('graph')}
                >
                  <Network size={16} /> Explore graph <ArrowRight size={15} />
                </button>
              </div>
              <div className="metric-grid">
                {[
                  {
                    label: 'Research sources',
                    value: sources.length,
                    icon: BookOpen,
                    trend: 'Documented references',
                    className: 'metric-blue',
                  },
                  {
                    label: 'Evidence claims',
                    value: claims.length,
                    icon: ShieldCheck,
                    trend: 'Researcher-authored',
                    className: 'metric-purple',
                  },
                  {
                    label: 'Active hypotheses',
                    value: hypotheses.filter(h => h.status !== 'resolved')
                      .length,
                    icon: Dna,
                    trend: 'Open investigations',
                    className: 'metric-green',
                  },
                  {
                    label: 'Connections mapped',
                    value: edges.length,
                    icon: GitBranch,
                    trend: 'Traceable relationships',
                    className: 'metric-amber',
                  },
                ].map(metric => (
                  <div key={metric.label} className="metric-card">
                    <div className="metric-top">
                      <span>{metric.label}</span>
                      <metric.icon size={18} className={metric.className} />
                    </div>
                    <strong>{metric.value.toString().padStart(2, '0')}</strong>
                    <div className="metric-footer">{metric.trend}</div>
                  </div>
                ))}
              </div>
              <div className="overview-grid">
                <section className="panel graph-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">
                        RELATIONSHIP VISUALIZATION
                      </span>
                      <h2>Evidence landscape</h2>
                    </div>
                    <button
                      className="text-link"
                      onClick={() => setView('graph')}
                    >
                      Full graph <ArrowRight size={15} />
                    </button>
                  </div>
                  <GraphCanvas records={records} onSelect={setDetail} compact />
                </section>
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">YOUR RESEARCH TRAIL</span>
                      <h2>Recent activity</h2>
                    </div>
                    <Activity size={17} />
                  </div>
                  {records.length ? (
                    [...records]
                      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                      .slice(0, 6)
                      .map(r => (
                        <button
                          className="activity-item"
                          key={r.id}
                          onClick={() => setDetail(r)}
                        >
                          <span className={'activity-icon kind-' + r.kind}>
                            {r.kind === 'source' ? (
                              <FileText size={17} />
                            ) : r.kind === 'edge' ? (
                              <Link2 size={17} />
                            ) : r.kind === 'claim' ? (
                              <ShieldCheck size={17} />
                            ) : (
                              <Dna size={17} />
                            )}
                          </span>
                          <span>
                            <strong>{r.title}</strong>
                            <small>
                              {kindLabels[r.kind]} · {shortDate(r.updatedAt)}
                            </small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                      ))
                  ) : (
                    <div className="empty-side">
                      <FilePlus2 size={26} />
                      <strong>Your research begins here.</strong>
                      <p>
                        Add your first source to start creating a traceable
                        evidence trail.
                      </p>
                      <button
                        className="mini-button"
                        onClick={() => openCreate('source')}
                      >
                        Add source <Plus size={14} />
                      </button>
                    </div>
                  )}
                </section>
              </div>
              <div className="section-head">
                <div>
                  <span className="eyebrow">QUICK START</span>
                  <h2>Build your evidence base</h2>
                </div>
              </div>
              <div className="quick-grid">
                <button
                  className="quick-card"
                  onClick={() => openCreate('source')}
                >
                  <div className="quick-icon blue">
                    <BookOpen size={22} />
                  </div>
                  <div>
                    <strong>Add a research source</strong>
                    <span>Document a paper, DOI, URL or PDF</span>
                  </div>
                  <ArrowRight size={17} />
                </button>
                <button
                  className="quick-card"
                  onClick={() => openCreate('claim')}
                >
                  <div className="quick-icon purple">
                    <ShieldCheck size={22} />
                  </div>
                  <div>
                    <strong>Record a claim</strong>
                    <span>Capture a testable scientific statement</span>
                  </div>
                  <ArrowRight size={17} />
                </button>
                <button
                  className="quick-card"
                  onClick={() => openCreate('hypothesis')}
                >
                  <div className="quick-icon green">
                    <Dna size={22} />
                  </div>
                  <div>
                    <strong>Explore a hypothesis</strong>
                    <span>Track status and confidence explicitly</span>
                  </div>
                  <ArrowRight size={17} />
                </button>
              </div>
            </>
          )}
          {view !== 'overview' && (
            <div className="page-heading">
              <div>
                <span className="eyebrow">EVIDENCE ATLAS / WORKSPACE</span>
                <h1>{pageTitle[view]}</h1>
                <p>
                  {view === 'library'
                    ? 'Curated references with clear provenance and source metadata.'
                    : view === 'claims'
                      ? 'Independent claims, evidence quality, and links back to sources.'
                      : view === 'graph'
                        ? 'Explore how studies, findings and hypotheses connect.'
                        : 'Track testable ideas, uncertainty and open research questions.'}
                </p>
              </div>
              <div className="page-actions">
                {view === 'graph' ? (
                  <button
                    className="primary-button"
                    onClick={() => openCreate('edge')}
                  >
                    <Plus size={17} /> Connect nodes
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    onClick={() =>
                      openCreate(
                        view === 'library'
                          ? 'source'
                          : view === 'claims'
                            ? 'claim'
                            : 'hypothesis'
                      )
                    }
                  >
                    <Plus size={17} /> New{' '}
                    {view === 'library'
                      ? 'source'
                      : view === 'claims'
                        ? 'claim'
                        : 'hypothesis'}
                  </button>
                )}
              </div>
            </div>
          )}
          {view === 'graph' && (
            <>
              <div className="graph-toolbar">
                <span>
                  <span className="tiny-green-dot" /> {nodes.length} nodes /{' '}
                  {edges.length} links
                </span>
                <span>Click a node to inspect provenance and evidence</span>
                <button
                  className="secondary-button small"
                  onClick={() => exportData('json')}
                >
                  <ArrowDownToLine size={15} /> Export graph
                </button>
              </div>
              <div className="panel full-graph">
                <GraphCanvas records={records} onSelect={setDetail} />
              </div>
              <div className="graph-annotation">
                <CircleHelp size={16} />
                <span>
                  Solid lines indicate relationships. Dashed coral lines
                  indicate contradictory evidence. This graph depicts
                  researcher-entered links, not independently verified
                  consensus.
                </span>
              </div>
              {edges.length > 0 && (
                <section className="relationship-list">
                  <div className="section-head">
                    <h2>Documented relationships</h2>
                  </div>
                  {edges.map(e => (
                    <button
                      className="record-row"
                      key={e.id}
                      onClick={() => setDetail(e)}
                    >
                      <span className="relation-line">
                        <Link2 size={16} />
                        {nodes.find(n => n.id === e.from)?.title ||
                          'Missing node'}{' '}
                        <b>{e.relation}</b>{' '}
                        {nodes.find(n => n.id === e.to)?.title ||
                          'Missing node'}
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </section>
              )}
            </>
          )}
          {(view === 'library' ||
            view === 'claims' ||
            view === 'hypotheses') && (
            <>
              <div className="list-toolbar">
                <div className="search-box">
                  <Search size={17} />
                  <input
                    aria-label="Search research records"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={
                      'Search ' +
                      (view === 'library'
                        ? 'sources, authors, DOIs…'
                        : 'titles, notes, tags…')
                    }
                  />
                  {search && (
                    <button onClick={() => setSearch('')}>
                      <X size={14} />
                    </button>
                  )}
                </div>
                <span className="item-count">
                  {filtered.length}{' '}
                  {view === 'library'
                    ? 'sources'
                    : view === 'claims'
                      ? 'claims'
                      : 'hypotheses'}
                </span>
                <button
                  className="secondary-button small"
                  onClick={() => exportData('csv')}
                >
                  <ArrowDownToLine size={15} /> Export CSV
                </button>
              </div>
              {filtered.length > 0 ? (
                <div className="records-grid">
                  {filtered.map(r => (
                    <article className="record-card" key={r.id}>
                      <div className="record-head">
                        <IconBadge kind={r.kind} />
                        <span className="record-date">
                          {shortDate(r.updatedAt)}
                        </span>
                      </div>
                      <button
                        className="record-main"
                        onClick={() => setDetail(r)}
                      >
                        <h3>{r.title}</h3>
                        <p>
                          {r.summary || 'No abstract or notes recorded yet.'}
                        </p>
                      </button>
                      <div className="record-tags">
                        {(r.tags || '')
                          .split(',')
                          .filter(Boolean)
                          .slice(0, 4)
                          .map(tag => (
                            <span key={tag}>{tag.trim()}</span>
                          ))}
                      </div>
                      <div className="record-footer">
                        {r.kind === 'source' ? (
                          <span>
                            <FileText size={14} />{' '}
                            {r.authors || 'Author not supplied'}
                            {r.year ? ' · ' + r.year : ''}
                          </span>
                        ) : (
                          <span>
                            <Activity size={14} /> {r.status} · {r.confidence}%
                            confidence
                          </span>
                        )}
                        <button onClick={() => setDetail(r)}>
                          Inspect <ArrowRight size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-list">
                  <div className="empty-orbit">
                    <BookMarked size={32} />
                  </div>
                  <h2>
                    {search
                      ? 'Nothing matches your search'
                      : 'A blank page, full of possibility.'}
                  </h2>
                  <p>
                    {search
                      ? 'Try another keyword or clear the search.'
                      : 'Start collecting your evidence. Each entry can connect to the wider research graph.'}
                  </p>
                  <button
                    className="primary-button"
                    onClick={() =>
                      search
                        ? setSearch('')
                        : openCreate(
                            view === 'library'
                              ? 'source'
                              : view === 'claims'
                                ? 'claim'
                                : 'hypothesis'
                          )
                    }
                  >
                    {search ? 'Clear search' : 'Create first record'}{' '}
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </>
          )}
          {cursor && (
            <div className="load-more">
              <button
                className="secondary-button"
                disabled={loading}
                onClick={() => void loadRecords(cursor)}
              >
                {loading ? 'Loading…' : 'Load more records'}
              </button>
            </div>
          )}
          <footer className="site-footer">
            <span>
              <Hexagon size={13} /> EVIDENCE ATLAS
            </span>
            <span>
              All confidence ratings are researcher assessments, not automated
              scientific validation.
            </span>
          </footer>
        </div>
      </main>
      {detail && (
        <div className="drawer-overlay" onClick={() => setDetail(null)}>
          <aside className="detail-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-top">
              <span>RECORD INSPECTOR</span>
              <button onClick={() => setDetail(null)} aria-label="Close detail">
                <X size={19} />
              </button>
            </div>
            <div className="drawer-body">
              <IconBadge kind={detail.kind} />
              <h2>{detail.title}</h2>
              <div className="record-date">
                Created {shortDate(detail.createdAt)} · Updated{' '}
                {shortDate(detail.updatedAt)}
              </div>
              <div className="drawer-section">
                <h4>DESCRIPTION / ABSTRACT</h4>
                <p>
                  {detail.summary ||
                    'No description has been entered for this record.'}
                </p>
              </div>
              {detail.kind === 'source' && (
                <div className="drawer-section">
                  <h4>BIBLIOGRAPHIC METADATA</h4>
                  <dl>
                    <dt>Authors</dt>
                    <dd>{detail.authors || 'Not supplied'}</dd>
                    <dt>Publication year</dt>
                    <dd>{detail.year || 'Not supplied'}</dd>
                    <dt>DOI</dt>
                    <dd>{detail.doi || 'Not supplied'}</dd>
                    <dt>Evidence quality</dt>
                    <dd>{detail.quality || 'Unassessed'}</dd>
                  </dl>
                  {detail.url && (
                    <a
                      className="outline-link"
                      href={detail.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open external source <ExternalLink size={15} />
                    </a>
                  )}
                  {detail.filePath && (
                    <button
                      className="outline-link"
                      onClick={() => void openAttachment(detail)}
                    >
                      Open attached PDF <FileText size={15} />
                    </button>
                  )}
                </div>
              )}
              {(detail.kind === 'claim' || detail.kind === 'hypothesis') && (
                <div className="drawer-section">
                  <h4>RESEARCHER ASSESSMENT</h4>
                  <div className="confidence-line">
                    <span>Confidence</span>
                    <strong>{detail.confidence}%</strong>
                  </div>
                  <div className="confidence-bar">
                    <div style={{ width: detail.confidence + '%' }} />
                  </div>
                  <p>
                    Status: <b>{detail.status}</b>
                  </p>
                  <small>
                    Subjective assessment, not an AI or statistical probability.
                  </small>
                </div>
              )}
              {detail.kind === 'edge' && (
                <div className="drawer-section">
                  <h4>RELATIONSHIP</h4>
                  <p>
                    {nodes.find(r => r.id === detail.from)?.title ||
                      'Missing record'}{' '}
                    <b>{detail.relation}</b>{' '}
                    {nodes.find(r => r.id === detail.to)?.title ||
                      'Missing record'}
                  </p>
                </div>
              )}
              {activeEdges.length > 0 && (
                <div className="drawer-section">
                  <h4>CONNECTED EVIDENCE</h4>
                  {activeEdges.map(e => (
                    <button
                      className="linked-record"
                      key={e.id}
                      onClick={() =>
                        setDetail(
                          nodes.find(
                            n => n.id === (e.from === detail.id ? e.to : e.from)
                          ) || e
                        )
                      }
                    >
                      <Link2 size={15} />
                      <span>
                        {e.relation}:{' '}
                        {nodes.find(
                          n => n.id === (e.from === detail.id ? e.to : e.from)
                        )?.title || 'Unknown'}
                      </span>
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              )}
              <div className="drawer-section">
                <h4>PROVENANCE</h4>
                <div className="provenance">
                  <ShieldCheck size={17} />
                  <div>
                    <strong>{detail.provenance || 'Researcher-entered'}</strong>
                    <small>
                      This record has not been automatically verified against
                      external publications.
                    </small>
                  </div>
                </div>
              </div>
            </div>
            <div className="drawer-actions">
              <button
                className="secondary-button"
                onClick={() => openEdit(detail)}
              >
                Edit record
              </button>
              <button
                className="danger-button"
                onClick={() => void deleteRecord(detail)}
              >
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </aside>
        </div>
      )}
      {modal && (
        <div
          className="modal-overlay"
          onClick={() => !saving && setModal(null)}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={'Edit ' + kindLabels[modal]}
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-title">
              <div>
                <span className="eyebrow">RESEARCH WORKSPACE</span>
                <h2>
                  {editing ? 'Edit' : 'New'} {kindLabels[modal].toLowerCase()}
                </h2>
              </div>
              <button
                aria-label="Close"
                onClick={() => setModal(null)}
                disabled={saving}
              >
                <X size={21} />
              </button>
            </div>
            <form onSubmit={saveRecord}>
              <div className="modal-scroll">
                <label className="field">
                  <span>
                    {modal === 'edge' ? 'Relationship label' : 'Title'} <b>*</b>
                  </span>
                  <input
                    autoFocus
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder={
                      modal === 'source'
                        ? 'e.g. A systematic review of…'
                        : modal === 'claim'
                          ? 'e.g. The evidence indicates…'
                          : modal === 'hypothesis'
                            ? 'e.g. If X, then Y…'
                            : 'e.g. Evidence linkage'
                    }
                    maxLength={240}
                  />
                </label>
                {modal === 'edge' ? (
                  <>
                    <div className="two-fields">
                      <label className="field">
                        <span>From record</span>
                        <select
                          value={form.from}
                          onChange={e =>
                            setForm({ ...form, from: e.target.value })
                          }
                        >
                          <option value="">Select source node</option>
                          {nodes.map(r => (
                            <option key={r.id} value={r.id}>
                              {kindLabels[r.kind]}: {r.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>To record</span>
                        <select
                          value={form.to}
                          onChange={e =>
                            setForm({ ...form, to: e.target.value })
                          }
                        >
                          <option value="">Select target node</option>
                          {nodes.map(r => (
                            <option key={r.id} value={r.id}>
                              {kindLabels[r.kind]}: {r.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="field">
                      <span>Relationship type</span>
                      <select
                        value={form.relation}
                        onChange={e =>
                          setForm({ ...form, relation: e.target.value })
                        }
                      >
                        {[
                          'supports',
                          'contradicts',
                          'depends on',
                          'extends',
                          'related to',
                        ].map(r => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="field">
                      <span>
                        {modal === 'source'
                          ? 'Abstract / notes'
                          : 'Description / reasoning'}
                      </span>
                      <textarea
                        rows={4}
                        value={form.summary}
                        onChange={e =>
                          setForm({ ...form, summary: e.target.value })
                        }
                        placeholder="Record the evidence, methodology, uncertainties, or research rationale…"
                      />
                    </label>
                    {modal === 'source' ? (
                      <>
                        <div className="two-fields">
                          <label className="field">
                            <span>Authors</span>
                            <input
                              value={form.authors}
                              onChange={e =>
                                setForm({ ...form, authors: e.target.value })
                              }
                              placeholder="Last name, et al."
                            />
                          </label>
                          <label className="field">
                            <span>Publication year</span>
                            <input
                              value={form.year}
                              maxLength={10}
                              onChange={e =>
                                setForm({ ...form, year: e.target.value })
                              }
                              placeholder="2026"
                            />
                          </label>
                        </div>
                        <div className="two-fields">
                          <label className="field">
                            <span>DOI</span>
                            <input
                              value={form.doi}
                              onChange={e =>
                                setForm({ ...form, doi: e.target.value })
                              }
                              placeholder="10.xxxx/example"
                            />
                          </label>
                          <label className="field">
                            <span>Evidence quality</span>
                            <select
                              value={form.quality}
                              onChange={e =>
                                setForm({ ...form, quality: e.target.value })
                              }
                            >
                              {['unassessed', 'low', 'moderate', 'high'].map(
                                x => (
                                  <option key={x}>{x}</option>
                                )
                              )}
                            </select>
                          </label>
                        </div>
                        <label className="field">
                          <span>Source URL (HTTPS)</span>
                          <input
                            value={form.url}
                            onChange={e =>
                              setForm({ ...form, url: e.target.value })
                            }
                            placeholder="https://doi.org/…"
                          />
                        </label>
                        {!editing && (
                          <label className="field">
                            <span>Optional PDF attachment (under 1 MB)</span>
                            <input
                              type="file"
                              accept="application/pdf,.pdf"
                              onChange={e =>
                                setFile(e.target.files?.[0] || null)
                              }
                            />
                          </label>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="two-fields">
                          <label className="field">
                            <span>Research status</span>
                            <select
                              value={form.status}
                              onChange={e =>
                                setForm({ ...form, status: e.target.value })
                              }
                            >
                              {[
                                'open',
                                'investigating',
                                'supported',
                                'contested',
                                'resolved',
                              ].map(x => (
                                <option key={x}>{x}</option>
                              ))}
                            </select>
                          </label>
                          <label className="field">
                            <span>Confidence ({form.confidence}%)</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={form.confidence}
                              onChange={e =>
                                setForm({
                                  ...form,
                                  confidence: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                        </div>
                        <p className="field-hint">
                          Confidence is your own research judgment, not a
                          machine-generated statistic.
                        </p>
                      </>
                    )}
                    <label className="field">
                      <span>Tags (comma separated)</span>
                      <input
                        value={form.tags}
                        onChange={e =>
                          setForm({ ...form, tags: e.target.value })
                        }
                        placeholder="genetics, neuroscience, methods"
                      />
                    </label>
                  </>
                )}
                {formError && <div className="form-error">{formError}</div>}
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setModal(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving}
                >
                  {saving
                    ? 'Saving…'
                    : editing
                      ? 'Save changes'
                      : 'Create record'}{' '}
                  <ArrowRight size={15} />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
