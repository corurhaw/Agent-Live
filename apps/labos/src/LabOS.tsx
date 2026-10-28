import { useEffect, useMemo, useState } from 'react';
import { api, auth } from '@appdeploy/client';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Beaker,
  Box,
  Cable,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CircleHelp,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  FlaskConical,
  Gauge,
  HardDrive,
  Layers,
  LayoutDashboard,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  Monitor,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import './labos.css';

type Kind = 'asset' | 'link' | 'experiment' | 'project' | 'purchase' | 'metric';
type Page =
  | 'overview'
  | 'inventory'
  | 'network'
  | 'telemetry'
  | 'experiments'
  | 'projects'
  | 'planning';
type User = { userId: string; name?: string; email?: string };
type LabRecord = {
  id: string;
  kind: Kind;
  title: string;
  description: string;
  category: string;
  status: string;
  priority: string;
  location: string;
  hostname: string;
  ip: string;
  vlan: string;
  cpu: string;
  gpu: string;
  ram: string;
  storage: string;
  os: string;
  network: string;
  watts: number;
  source: string;
  target: string;
  speed: string;
  objective: string;
  procedure: string;
  observations: string;
  results: string;
  tasks: string;
  progress: number;
  price: number;
  targetPrice: number;
  cpuPct: number;
  ramPct: number;
  diskPct: number;
  temperature: number;
  throughput: number;
  origin: string;
  createdAt: string;
  updatedAt: string;
};
type Editable = Omit<LabRecord, 'id' | 'origin' | 'createdAt' | 'updatedAt'>;
const newForm = (kind: Kind): Editable => ({
  kind,
  title: '',
  description: '',
  category: 'Workstation',
  status:
    kind === 'asset'
      ? 'Documented'
      : kind === 'experiment'
        ? 'Draft'
        : kind === 'project'
          ? 'Planning'
          : 'Considering',
  priority: 'Medium',
  location: '',
  hostname: '',
  ip: '',
  vlan: '',
  cpu: '',
  gpu: '',
  ram: '',
  storage: '',
  os: '',
  network: '',
  watts: 0,
  source: '',
  target: '',
  speed: '10 GbE',
  objective: '',
  procedure: '',
  observations: '',
  results: '',
  tasks: '',
  progress: 0,
  price: 0,
  targetPrice: 0,
  cpuPct: 0,
  ramPct: 0,
  diskPct: 0,
  temperature: 0,
  throughput: 0,
});
const navigation: {
  page: Page;
  name: string;
  icon: typeof LayoutDashboard;
  group: string;
}[] = [
  {
    page: 'overview',
    name: 'Overview',
    icon: LayoutDashboard,
    group: 'WORKSPACE',
  },
  {
    page: 'inventory',
    name: 'Asset inventory',
    icon: Server,
    group: 'WORKSPACE',
  },
  {
    page: 'network',
    name: 'Network topology',
    icon: Network,
    group: 'WORKSPACE',
  },
  { page: 'telemetry', name: 'Monitoring', icon: Activity, group: 'WORKSPACE' },
  {
    page: 'experiments',
    name: 'Experiment notebook',
    icon: FlaskConical,
    group: 'RESEARCH',
  },
  {
    page: 'projects',
    name: 'Projects & tasks',
    icon: Layers,
    group: 'RESEARCH',
  },
  {
    page: 'planning',
    name: 'Procurement',
    icon: CircleDollarSign,
    group: 'PLANNING',
  },
];
const titles: Record<Page, string> = {
  overview: 'Lab overview',
  inventory: 'Asset inventory',
  network: 'Network topology',
  telemetry: 'Compute monitoring',
  experiments: 'Experiment notebook',
  projects: 'Projects & tasks',
  planning: 'Procurement planning',
};
const subtitles: Record<Page, string> = {
  overview: 'One workspace for everything in your engineering lab.',
  inventory: 'Document and manage your physical and virtual equipment.',
  network: 'Map connections, VLANs, interfaces and network boundaries.',
  telemetry: 'Record hardware measurements; no live agents connected.',
  experiments: 'Record methods, observations, and reproducible results.',
  projects: 'Manage milestones, dependencies and work in progress.',
  planning: 'Track potential upgrades and expected costs.',
};
const kindNames: Record<Kind, string> = {
  asset: 'Asset',
  link: 'Network link',
  experiment: 'Experiment',
  project: 'Project',
  purchase: 'Purchase item',
  metric: 'Measurement',
};
const money = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n || 0);
const shortDate = (v?: string) =>
  v
    ? new Date(v).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';
function saveDownload(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function categoryIcon(category: string) {
  const c = category.toLowerCase();
  if (c.includes('nas') || c.includes('storage'))
    return <HardDrive size={19} />;
  if (c.includes('switch') || c.includes('router') || c.includes('network'))
    return <Network size={19} />;
  if (c.includes('fpga') || c.includes('develop') || c.includes('micro'))
    return <Cpu size={19} />;
  if (c.includes('server')) return <Server size={19} />;
  return <Monitor size={19} />;
}
function StatusPill({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const hue =
    lower.includes('progress') ||
    lower.includes('documented') ||
    lower.includes('complete')
      ? 'green'
      : lower.includes('draft') ||
          lower.includes('planned') ||
          lower.includes('planning')
        ? 'blue'
        : 'orange';
  return (
    <span className={'status-pill ' + hue}>
      <i />
      {value}
    </span>
  );
}

function Topology({
  items,
  onNode,
  compact = false,
}: {
  items: LabRecord[];
  onNode: (r: LabRecord) => void;
  compact?: boolean;
}) {
  const nodes = items
    .filter(r => r.kind === 'asset')
    .slice(0, compact ? 8 : 24);
  const links = items.filter(r => r.kind === 'link');
  const coordinate = new Map(
    nodes.map((r, i) => {
      const total = nodes.length;
      const angle = (i / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = total === 1 ? 0 : compact ? 150 : 168;
      return [
        r.id,
        {
          x: 380 + Math.cos(angle) * radius,
          y: 208 + Math.sin(angle) * radius,
        },
      ] as const;
    })
  );
  return (
    <div className={'topology ' + (compact ? 'compact' : '')}>
      {nodes.length ? (
        <svg
          viewBox="0 0 760 430"
          className="topology-svg"
          role="img"
          aria-label="Network topology diagram"
        >
          <defs>
            <pattern
              id="lab-grid"
              width="25"
              height="25"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 25 0 L 0 0 0 25"
                stroke="#274051"
                strokeWidth=".55"
                fill="none"
              />
            </pattern>
          </defs>
          <rect width="760" height="430" fill="url(#lab-grid)" />
          {links.map(l => {
            const a = coordinate.get(l.source),
              b = coordinate.get(l.target);
            return a && b ? (
              <g key={l.id}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#408f9f"
                  strokeWidth="2.5"
                  opacity=".78"
                  strokeDasharray="7 5"
                />
                {!compact && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 10}
                    textAnchor="middle"
                    fill="#8bafbc"
                    fontSize="11"
                  >
                    {l.speed}
                  </text>
                )}
              </g>
            ) : null;
          })}
          {nodes.map(n => {
            const p = coordinate.get(n.id)!;
            return (
              <g
                key={n.id}
                className="top-node"
                role="button"
                tabIndex={0}
                aria-label={'Inspect ' + n.title}
                onClick={() => onNode(n)}
                onKeyDown={e => {
                  if (e.key === 'Enter') onNode(n);
                }}
              >
                <rect
                  x={p.x - compact ? 0 : 0}
                  y={0}
                  width={0}
                  height={0}
                  fill="none"
                />
                <rect
                  x={p.x - 61}
                  y={p.y - 25}
                  width="122"
                  height="52"
                  rx="10"
                  fill="#102a36"
                  stroke="#38747d"
                  strokeWidth="1.6"
                />
                <circle cx={p.x - 42} cy={p.y} r="5" fill="#67d5bb" />
                <text
                  x={p.x + 4}
                  y={p.y - 3}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#e5f5f4"
                  fontWeight="700"
                >
                  {n.title.length > 18 ? n.title.slice(0, 16) + '…' : n.title}
                </text>
                <text
                  x={p.x + 4}
                  y={p.y + 11}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#87aab8"
                >
                  {n.vlan || n.category}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="blank-topology">
          <Network size={40} />
          <strong>Your network map starts here</strong>
          <span>Add devices, then connect them using Network link.</span>
        </div>
      )}
      <div className="topology-legend">
        <span>
          <i /> DOCUMENTED TOPOLOGY
        </span>
        <span>Not live-discovered</span>
      </div>
    </div>
  );
}

function MiniBars({ readings }: { readings: LabRecord[] }) {
  const data = [...readings].reverse().slice(-12);
  return (
    <div className="mini-bars">
      {data.length ? (
        data.map(r => (
          <div
            className="bar-item"
            key={r.id}
            title={shortDate(r.createdAt) + ': ' + r.cpuPct + '% CPU'}
          >
            <div className="bar-track">
              <div style={{ height: Math.max(3, r.cpuPct) + '%' }} />
            </div>
            <small>
              {new Date(r.createdAt).toLocaleDateString('en-US', {
                month: 'numeric',
                day: 'numeric',
              })}
            </small>
          </div>
        ))
      ) : (
        <div className="no-readings">
          No recorded history yet. Save a reading to start your chart.
        </div>
      )}
    </div>
  );
}
function Empty({
  icon: Icon,
  title,
  description,
  action,
  label,
}: {
  icon: typeof Box;
  title: string;
  description: string;
  action: () => void;
  label: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={28} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <button className="primary" onClick={action}>
        <Plus size={16} />
        {label}
      </button>
    </div>
  );
}
const fieldTypes: Record<
  Kind,
  { name: keyof Editable; label: string; type?: string; choices?: string[] }[]
> = {
  asset: [
    { name: 'title', label: 'Asset name' },
    {
      name: 'category',
      label: 'Device category',
      choices: [
        'Workstation',
        'Server',
        'NAS',
        'Router',
        'Switch',
        'Development',
        'Microcontroller',
        'Instrument',
        'Other',
      ],
    },
    {
      name: 'status',
      label: 'Documentation status',
      choices: ['Documented', 'Planned', 'Retired', 'Maintenance'],
    },
    { name: 'hostname', label: 'Hostname' },
    { name: 'ip', label: 'IP address' },
    { name: 'vlan', label: 'VLAN / network' },
    { name: 'cpu', label: 'CPU / processor' },
    { name: 'gpu', label: 'GPU / accelerator' },
    { name: 'ram', label: 'Memory' },
    { name: 'storage', label: 'Storage' },
    { name: 'network', label: 'Network interface' },
    { name: 'os', label: 'Operating system' },
    { name: 'location', label: 'Physical location' },
    { name: 'watts', label: 'Estimated power (W)', type: 'number' },
    { name: 'description', label: 'Maintenance notes', type: 'textarea' },
  ],
  link: [
    { name: 'title', label: 'Connection label' },
    { name: 'source', label: 'From device', type: 'device' },
    { name: 'target', label: 'To device', type: 'device' },
    {
      name: 'speed',
      label: 'Link speed',
      choices: [
        '100 MbE',
        '1 GbE',
        '2.5 GbE',
        '5 GbE',
        '10 GbE',
        '25 GbE',
        '40 GbE',
        '100 GbE',
        'Wi-Fi',
        'Other',
      ],
    },
    {
      name: 'description',
      label: 'Interface / cable / remarks',
      type: 'textarea',
    },
  ],
  experiment: [
    { name: 'title', label: 'Experiment title' },
    {
      name: 'category',
      label: 'Domain',
      choices: [
        'Embedded systems',
        'FPGA',
        'Networking',
        'Software',
        'Electronics',
        'Thermal systems',
        'Other',
      ],
    },
    {
      name: 'status',
      label: 'Status',
      choices: ['Draft', 'Running', 'Paused', 'Completed'],
    },
    { name: 'objective', label: 'Research objective', type: 'textarea' },
    { name: 'procedure', label: 'Procedure / method', type: 'textarea' },
    {
      name: 'observations',
      label: 'Observations / raw notes',
      type: 'textarea',
    },
    { name: 'results', label: 'Results & conclusions', type: 'textarea' },
  ],
  project: [
    { name: 'title', label: 'Project name' },
    {
      name: 'status',
      label: 'Status',
      choices: ['Planning', 'In progress', 'Blocked', 'Completed'],
    },
    {
      name: 'priority',
      label: 'Priority',
      choices: ['Low', 'Medium', 'High', 'Critical'],
    },
    { name: 'progress', label: 'Estimated progress (%)', type: 'number' },
    { name: 'description', label: 'Scope / purpose', type: 'textarea' },
    { name: 'tasks', label: 'Tasks (one per line)', type: 'textarea' },
  ],
  purchase: [
    { name: 'title', label: 'Equipment or upgrade' },
    {
      name: 'category',
      label: 'Category',
      choices: [
        'GPU',
        'Storage',
        'Networking',
        'Compute',
        'Instrumentation',
        'Other',
      ],
    },
    {
      name: 'status',
      label: 'Status',
      choices: ['Considering', 'Shortlisted', 'Ordered', 'Purchased'],
    },
    {
      name: 'priority',
      label: 'Priority',
      choices: ['Low', 'Medium', 'High', 'Critical'],
    },
    { name: 'price', label: 'Estimated price (USD)', type: 'number' },
    { name: 'targetPrice', label: 'Target price (USD)', type: 'number' },
    {
      name: 'description',
      label: 'Specifications and notes',
      type: 'textarea',
    },
  ],
  metric: [
    { name: 'title', label: 'Reading label' },
    { name: 'source', label: 'Device', type: 'device' },
    { name: 'cpuPct', label: 'CPU usage (%)', type: 'number' },
    { name: 'ramPct', label: 'RAM usage (%)', type: 'number' },
    { name: 'diskPct', label: 'Disk usage (%)', type: 'number' },
    { name: 'temperature', label: 'Temperature (°C)', type: 'number' },
    { name: 'throughput', label: 'Network throughput (Mb/s)', type: 'number' },
    { name: 'description', label: 'Measurement context', type: 'textarea' },
  ],
};

export default function LabOS() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [signing, setSigning] = useState(false);
  const [page, setPage] = useState<Page>('overview');
  const [items, setItems] = useState<LabRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState('');
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState<Kind | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Editable>(newForm('asset'));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [detail, setDetail] = useState<LabRecord | null>(null);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [demoLoading, setDemoLoading] = useState(false);
  useEffect(() => {
    auth
      .getUser()
      .then(u => setUser(u))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (user) void load();
    else setItems([]);
  }, [user?.userId]);
  async function load(next?: string) {
    setLoading(true);
    try {
      const response = await api.get(
        '/api/records' + (next ? '?cursor=' + encodeURIComponent(next) : '')
      );
      setItems(old =>
        next
          ? [...old, ...(response.data.records as LabRecord[])]
          : (response.data.records as LabRecord[])
      );
      setCursor(response.data.nextToken || null);
      setFlash('');
    } catch {
      setFlash('Unable to load your workspace. Please retry.');
    } finally {
      setLoading(false);
    }
  }
  async function login() {
    setSigning(true);
    try {
      const r = await auth.signIn();
      setUser(r.user);
      setFlash('');
    } catch (e) {
      const code = (e as { code?: string }).code;
      setFlash(
        code === 'popup_blocked'
          ? 'Allow popups to sign in.'
          : code === 'popup_closed'
            ? 'Sign-in cancelled.'
            : 'Sign-in unavailable.'
      );
    } finally {
      setSigning(false);
    }
  }
  async function logout() {
    await auth.signOut();
    setUser(null);
    setPage('overview');
    setDetail(null);
  }
  function navigate(p: Page) {
    setPage(p);
    setSearch('');
    setDetail(null);
    setSidebarOpen(false);
  }
  const assets = items.filter(r => r.kind === 'asset');
  const links = items.filter(r => r.kind === 'link');
  const experiments = items.filter(r => r.kind === 'experiment');
  const projects = items.filter(r => r.kind === 'project');
  const purchases = items.filter(r => r.kind === 'purchase');
  const metrics = items.filter(r => r.kind === 'metric');
  const plannedSpend = purchases
    .filter(r => r.status !== 'Purchased')
    .reduce((sum, r) => sum + r.price, 0);
  const latestMetric = (id: string) =>
    metrics
      .filter(r => r.source === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const inspected = detail
    ? items.find(r => r.id === detail.id) || detail
    : null;
  const visible = useMemo(() => {
    const kind: Partial<Record<Page, Kind>> = {
      inventory: 'asset',
      experiments: 'experiment',
      projects: 'project',
      planning: 'purchase',
    };
    const q = search.toLowerCase().trim();
    return items
      .filter(
        r =>
          r.kind === kind[page] &&
          (!q ||
            [r.title, r.category, r.hostname, r.description, r.status, r.vlan]
              .join(' ')
              .toLowerCase()
              .includes(q))
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [items, page, search]);
  function newItem(kind: Kind) {
    setForm(newForm(kind));
    setModal(kind);
    setEditId(null);
    setFormError('');
    setDetail(null);
  }
  function editItem(r: LabRecord) {
    const copy = newForm(r.kind);
    for (const key of Object.keys(copy) as (keyof Editable)[])
      (copy as unknown as Record<string, unknown>)[key] = r[key];
    setForm(copy);
    setEditId(r.id);
    setModal(r.kind);
    setFormError('');
    setDetail(null);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.title.trim()) {
      setFormError('A name or title is required.');
      return;
    }
    if (
      (form.kind === 'link' &&
        (!form.source || !form.target || form.source === form.target)) ||
      (form.kind === 'metric' && !form.source)
    ) {
      setFormError('Select valid, distinct devices.');
      return;
    }
    setSaving(true);
    try {
      const id = editId || crypto.randomUUID();
      const response = editId
        ? await api.put('/api/records/' + id, { ...form, id })
        : await api.post('/api/records', { ...form, id });
      const record = response.data.record as LabRecord;
      setItems(previous => [
        record,
        ...previous.filter(r => r.id !== record.id),
      ]);
      setModal(null);
      setEditId(null);
      setFlash('');
      if (record.kind === 'link') navigate('network');
      if (record.kind === 'metric') {
        setSelectedDevice(record.source);
        navigate('telemetry');
      }
    } catch (e) {
      const err = e as {
        response?: { data?: { error?: string; message?: string } };
        message?: string;
      };
      setFormError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          err.message ||
          'Save failed. Please retry.'
      );
    } finally {
      setSaving(false);
    }
  }
  async function remove(r: LabRecord) {
    if (
      !window.confirm(
        'Delete "' +
          r.title +
          '"?' +
          (r.kind === 'asset'
            ? ' Its links and readings will also be removed.'
            : '') +
          ' This cannot be undone.'
      )
    )
      return;
    try {
      await api.delete('/api/records/' + r.id);
      setItems(existing =>
        existing.filter(
          item =>
            item.id !== r.id &&
            !(
              r.kind === 'asset' &&
              ((item.kind === 'link' &&
                (item.source === r.id || item.target === r.id)) ||
                (item.kind === 'metric' && item.source === r.id))
            )
        )
      );
      setDetail(null);
      setFlash('Record deleted.');
    } catch {
      setFlash('Delete failed. Please retry.');
    }
  }
  async function sample() {
    setDemoLoading(true);
    try {
      const response = await api.post('/api/demo', {});
      setItems(response.data.records as LabRecord[]);
      setFlash('Example workspace loaded. These are fictional demo records.');
    } catch {
      setFlash(
        'Example data can only be loaded into an empty workspace. Refresh and retry if needed.'
      );
    } finally {
      setDemoLoading(false);
    }
  }
  function exportRecords(format: 'json' | 'csv') {
    if (format === 'json')
      saveDownload(
        'labos-export.json',
        JSON.stringify(
          { version: 1, exportedAt: new Date().toISOString(), records: items },
          null,
          2
        ),
        'application/json'
      );
    else {
      const keys = [
        'id',
        'kind',
        'title',
        'status',
        'category',
        'hostname',
        'ip',
        'vlan',
        'location',
        'description',
        'priority',
        'price',
        'targetPrice',
        'createdAt',
        'updatedAt',
        'origin',
      ];
      const q = (x: unknown) => '"' + String(x ?? '').replace(/"/g, '""') + '"';
      saveDownload(
        'labos-export.csv',
        [
          keys.join(','),
          ...items.map(r =>
            keys
              .map(k => q((r as unknown as Record<string, unknown>)[k]))
              .join(',')
          ),
        ].join('\n'),
        'text/csv;charset=utf-8'
      );
    }
  }
  function recordCard(r: LabRecord) {
    return (
      <article className="entry-card" key={r.id}>
        <div className="entry-top">
          <span className="entry-category">
            {r.kind === 'experiment' ? (
              <Beaker size={14} />
            ) : r.kind === 'project' ? (
              <Layers size={14} />
            ) : (
              <CircleDollarSign size={14} />
            )}{' '}
            {r.category || kindNames[r.kind]}
          </span>
          <StatusPill value={r.status} />
        </div>
        <button className="entry-main" onClick={() => setDetail(r)}>
          <h3>{r.title}</h3>
          <p>{r.description || r.objective || 'No description entered yet.'}</p>
        </button>
        {r.kind === 'project' && (
          <div className="progress-row">
            <div className="progress-track">
              <div style={{ width: r.progress + '%' }} />
            </div>
            <span>{r.progress}%</span>
          </div>
        )}
        {r.kind === 'purchase' && (
          <div className="cost-line">
            <b>{money(r.price)}</b>
            <span>Target: {money(r.targetPrice)}</span>
          </div>
        )}
        {r.kind === 'experiment' && (
          <div className="entry-details">
            <span>{r.procedure ? 'Method documented' : 'Method pending'}</span>
            <span>{r.results ? 'Results recorded' : 'Results pending'}</span>
          </div>
        )}
        <div className="entry-footer">
          <span>
            {r.origin === 'demo'
              ? 'Sample record'
              : 'Updated ' + shortDate(r.updatedAt)}
          </span>
          <button onClick={() => setDetail(r)}>
            Inspect <ArrowRight size={14} />
          </button>
        </div>
      </article>
    );
  }
  if (checking)
    return (
      <div className="login-screen">
        <div className="spinner" />
        <span>Initializing LabOS...</span>
      </div>
    );
  if (!user)
    return (
      <div className="login-screen">
        <div className="login-grid" />
        <div className="login-mark">
          <Terminal size={31} />
        </div>
        <div className="login-eyebrow">PERSONAL ENGINEERING WORKSPACE</div>
        <h1>
          Control your lab.
          <br />
          <span>Own your infrastructure.</span>
        </h1>
        <p>
          Document hardware, map your network, record experiments, and build
          your next project—all in one private command center.
        </p>
        <button
          className="primary login-action"
          onClick={login}
          disabled={signing}
        >
          {signing ? 'Opening secure sign-in…' : 'Enter LabOS workspace'}
          <ArrowRight size={18} />
        </button>
        {flash && <div className="login-error">{flash}</div>}
        <div className="login-perks">
          <span>
            <LockKeyhole size={15} /> Account-private
          </span>
          <span>
            <Database size={15} /> Persistent records
          </span>
          <span>
            <ShieldCheck size={15} /> No LAN scanning
          </span>
        </div>
        <div className="login-footer">
          LABOS <span>ENGINEERING LABORATORY SYSTEM / V1.0</span>
        </div>
      </div>
    );
  return (
    <div className="shell">
      <aside className={'sidebar ' + (sidebarOpen ? 'sidebar-open' : '')}>
        <div className="brand">
          <div className="brand-logo">
            <Terminal size={21} />
          </div>
          <div>
            <strong>
              LAB<span>OS</span>
            </strong>
            <small>ENGINEERING CONTROL</small>
          </div>
          <span className="brand-version">V1</span>
        </div>
        <div className="sidebar-space">
          <span className="space-icon">
            <Box size={17} />
          </span>
          <div>
            <strong>Personal laboratory</strong>
            <span>Private workspace</span>
          </div>
          <ChevronDown size={14} />
        </div>
        {['WORKSPACE', 'RESEARCH', 'PLANNING'].map(group => (
          <div key={group} className="nav-group">
            <div className="nav-group-name">{group}</div>
            {navigation
              .filter(item => item.group === group)
              .map(item => (
                <button
                  className={
                    'nav-item ' + (page === item.page ? 'selected' : '')
                  }
                  key={item.page}
                  onClick={() => navigate(item.page)}
                >
                  <item.icon size={18} />
                  {item.name}
                  {item.page === 'inventory' && assets.length > 0 && (
                    <span className="nav-counter">{assets.length}</span>
                  )}
                </button>
              ))}
          </div>
        ))}
        <div className="sidebar-bottom">
          <div className="connection-box">
            <div>
              <span className="standby-dot" /> LOCAL TELEMETRY
            </div>
            <strong>Not connected</strong>
            <p>Manual & sample measurements only</p>
          </div>
          <button className="profile" onClick={logout}>
            <span className="avatar">
              {(user.name || user.email || 'R')[0].toUpperCase()}
            </span>
            <span>
              <b>{user.name || 'Lab administrator'}</b>
              <small>{user.email || 'Signed in'}</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {sidebarOpen && (
        <div className="screen-shade" onClick={() => setSidebarOpen(false)} />
      )}
      <div className="workarea">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="menu-toggle"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>LABORATORY</span>
            <ChevronRight size={14} />
            <strong>{titles[page]}</strong>
          </div>
          <div className="top-buttons">
            <span className="secure-pill">
              <LockKeyhole size={13} /> PRIVATE
            </span>
            <button
              className="icon-button"
              title="Refresh"
              onClick={() => void load()}
            >
              <RefreshCw size={18} />
            </button>
            <button
              className="top-export"
              onClick={() => exportRecords('json')}
            >
              <ArrowDownToLine size={16} /> Export
            </button>
            <button
              className="primary top-add"
              onClick={() => newItem('asset')}
            >
              <Plus size={17} /> Add asset
            </button>
          </div>
        </header>
        <main className="main-content">
          {flash && (
            <div className="flash">
              {flash}
              <button onClick={() => setFlash('')} aria-label="Dismiss notice">
                <X size={15} />
              </button>
            </div>
          )}
          {page === 'overview' ? (
            <>
              <div className="hero">
                <div className="hero-content">
                  <div className="eyebrow">
                    <span className="eyebrow-dot" /> LABORATORY COMMAND CENTER
                  </div>
                  <h1>
                    Your lab.
                    <br />
                    <em>At a glance.</em>
                  </h1>
                  <p>
                    All your infrastructure, research and engineering projects
                    in one organized workspace.
                  </p>
                  <div className="hero-actions">
                    <button
                      className="primary"
                      onClick={() => newItem('asset')}
                    >
                      <Plus size={16} /> Register equipment
                    </button>
                    <button
                      className="outline"
                      onClick={() => navigate('network')}
                    >
                      View topology <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <span className="orbit orbit-a" />
                  <span className="orbit orbit-b" />
                  <span className="orbit orbit-c" />
                  <div className="hero-center">
                    <Cpu size={45} />
                  </div>
                  <span className="art-chip a">
                    <Server size={17} />
                  </span>
                  <span className="art-chip b">
                    <Network size={17} />
                  </span>
                  <span className="art-chip c">
                    <HardDrive size={17} />
                  </span>
                </div>
              </div>
              <div className="metrics-grid">
                <div className="metric-card">
                  <div className="metric-title">
                    REGISTERED ASSETS <Server size={19} />
                  </div>
                  <div className="metric-value">
                    {String(assets.length).padStart(2, '0')}
                  </div>
                  <div className="metric-sub">Documented lab equipment</div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">
                    NETWORK LINKS <Network size={19} />
                  </div>
                  <div className="metric-value">
                    {String(links.length).padStart(2, '0')}
                  </div>
                  <div className="metric-sub">Mapped device connections</div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">
                    ACTIVE PROJECTS <Layers size={19} />
                  </div>
                  <div className="metric-value">
                    {String(
                      projects.filter(r => r.status !== 'Completed').length
                    ).padStart(2, '0')}
                  </div>
                  <div className="metric-sub">Engineering initiatives</div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">
                    PLANNED SPEND <CircleDollarSign size={19} />
                  </div>
                  <div className="metric-value">{money(plannedSpend)}</div>
                  <div className="metric-sub">Estimated, not live pricing</div>
                </div>
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">INFRASTRUCTURE</div>
                      <h2>Network topology</h2>
                    </div>
                    <button
                      className="panel-action"
                      onClick={() => navigate('network')}
                    >
                      Expand map <ArrowRight size={15} />
                    </button>
                  </div>
                  <Topology items={items} onNode={setDetail} compact />
                </section>
                <section className="panel snapshot">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">SYSTEM ACTIVITY</div>
                      <h2>Compute snapshots</h2>
                    </div>
                    <span className="tag-warning">NOT LIVE</span>
                  </div>
                  {assets.length ? (
                    assets.slice(0, 5).map(a => {
                      const m = latestMetric(a.id);
                      return (
                        <button
                          className="snapshot-row"
                          key={a.id}
                          onClick={() => {
                            setSelectedDevice(a.id);
                            navigate('telemetry');
                          }}
                        >
                          <span className="snapshot-icon">
                            {categoryIcon(a.category)}
                          </span>
                          <span className="snapshot-text">
                            <strong>{a.title}</strong>
                            <small>
                              {m
                                ? m.origin === 'demo'
                                  ? 'Demo reading'
                                  : 'Manual reading'
                                : 'No readings yet'}
                            </small>
                          </span>
                          <span className="snapshot-num">
                            {m ? m.cpuPct + '%' : '—'}
                            <small>CPU</small>
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="snapshot-empty">
                      <Gauge size={28} />
                      <strong>No devices or readings</strong>
                      <span>
                        Register a system to begin tracking measurements.
                      </span>
                    </div>
                  )}
                </section>
              </div>
              <div className="bottom-grid">
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">IN PROGRESS</div>
                      <h2>Current projects</h2>
                    </div>
                    <button
                      className="panel-action"
                      onClick={() => navigate('projects')}
                    >
                      View all <ArrowRight size={15} />
                    </button>
                  </div>
                  {projects.length ? (
                    projects.slice(0, 3).map(p => (
                      <button
                        key={p.id}
                        className="project-row"
                        onClick={() => setDetail(p)}
                      >
                        <span className="project-symbol">
                          <Layers size={17} />
                        </span>
                        <span className="project-info">
                          <strong>{p.title}</strong>
                          <small>
                            {p.status} · {p.priority} priority
                          </small>
                        </span>
                        <span className="progress-mini">{p.progress}%</span>
                      </button>
                    ))
                  ) : (
                    <div className="short-empty">
                      No projects yet.{' '}
                      <button onClick={() => newItem('project')}>
                        Start a project
                      </button>
                    </div>
                  )}
                </section>
                <section className="panel quick-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">QUICK ACTIONS</div>
                      <h2>Continue building</h2>
                    </div>
                  </div>
                  <div className="action-grid">
                    <button onClick={() => newItem('experiment')}>
                      <span className="action-tile teal">
                        <Beaker size={21} />
                      </span>
                      New experiment <ArrowRight size={15} />
                    </button>
                    <button onClick={() => newItem('purchase')}>
                      <span className="action-tile violet">
                        <CircleDollarSign size={21} />
                      </span>
                      Plan an upgrade <ArrowRight size={15} />
                    </button>
                    <button onClick={() => newItem('metric')}>
                      <span className="action-tile amber">
                        <Activity size={21} />
                      </span>
                      Record telemetry <ArrowRight size={15} />
                    </button>
                  </div>
                </section>
              </div>
              {items.length === 0 && (
                <div className="sample-banner">
                  <div>
                    <strong>Explore LabOS with an example lab</strong>
                    <p>
                      Loads clearly marked fictional hardware, network links,
                      projects, experiments and sample readings. Nothing is
                      connected to your actual LAN.
                    </p>
                  </div>
                  <button
                    className="outline"
                    disabled={demoLoading}
                    onClick={() => void sample()}
                  >
                    {demoLoading ? 'Loading…' : 'Load example lab'}
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">LABOS / {page.toUpperCase()}</div>
                  <h1>{titles[page]}</h1>
                  <p>{subtitles[page]}</p>
                </div>
                <div className="page-heading-buttons">
                  {page === 'inventory' && (
                    <button
                      className="primary"
                      onClick={() => newItem('asset')}
                    >
                      <Plus size={17} /> Add asset
                    </button>
                  )}
                  {page === 'network' && (
                    <button className="primary" onClick={() => newItem('link')}>
                      <Plus size={17} /> Add link
                    </button>
                  )}
                  {page === 'telemetry' && (
                    <button
                      className="primary"
                      onClick={() => newItem('metric')}
                    >
                      <Plus size={17} /> Record reading
                    </button>
                  )}
                  {page === 'experiments' && (
                    <button
                      className="primary"
                      onClick={() => newItem('experiment')}
                    >
                      <Plus size={17} /> New experiment
                    </button>
                  )}
                  {page === 'projects' && (
                    <button
                      className="primary"
                      onClick={() => newItem('project')}
                    >
                      <Plus size={17} /> New project
                    </button>
                  )}
                  {page === 'planning' && (
                    <button
                      className="primary"
                      onClick={() => newItem('purchase')}
                    >
                      <Plus size={17} /> Add equipment
                    </button>
                  )}
                </div>
              </div>
              {['inventory', 'experiments', 'projects', 'planning'].includes(
                page
              ) && (
                <>
                  {page === 'planning' && (
                    <div className="planning-summary">
                      <div>
                        <span>ESTIMATED EQUIPMENT TOTAL</span>
                        <strong>
                          {money(purchases.reduce((s, p) => s + p.price, 0))}
                        </strong>
                      </div>
                      <div>
                        <span>UNPURCHASED BUDGET</span>
                        <strong>{money(plannedSpend)}</strong>
                      </div>
                      <div>
                        <span>TRACKED ITEMS</span>
                        <strong>{purchases.length}</strong>
                      </div>
                      <small>
                        Manually entered estimates; not store quotes.
                      </small>
                    </div>
                  )}
                  <div className="list-toolbar">
                    <div className="search-field">
                      <Search size={17} />
                      <input
                        placeholder="Search by name, model, status..."
                        aria-label="Search records"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                      />
                      {search && (
                        <button
                          onClick={() => setSearch('')}
                          aria-label="Clear search"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <span>{visible.length} records</span>
                    <button
                      className="outline small"
                      onClick={() => exportRecords('csv')}
                    >
                      <ArrowDownToLine size={15} /> CSV
                    </button>
                  </div>
                  {page === 'inventory' ? (
                    visible.length ? (
                      <div className="inventory-table-wrap">
                        <table className="inventory-table">
                          <thead>
                            <tr>
                              <th>DEVICE</th>
                              <th>CATEGORY</th>
                              <th>NETWORK / VLAN</th>
                              <th>LOCATION</th>
                              <th>STATUS</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map(a => (
                              <tr key={a.id} onClick={() => setDetail(a)}>
                                <td>
                                  <div className="device-name">
                                    <span className="device-symbol">
                                      {categoryIcon(a.category)}
                                    </span>
                                    <span>
                                      <strong>{a.title}</strong>
                                      <small>
                                        {a.hostname ||
                                          a.cpu ||
                                          'No model entered'}
                                      </small>
                                    </span>
                                  </div>
                                </td>
                                <td>{a.category}</td>
                                <td>
                                  <strong className="ip">{a.ip || '—'}</strong>
                                  <small className="ip-sub">
                                    {a.vlan || 'VLAN unassigned'}
                                  </small>
                                </td>
                                <td>{a.location || '—'}</td>
                                <td>
                                  <StatusPill value={a.status} />
                                </td>
                                <td>
                                  <ChevronRight size={17} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        icon={Server}
                        title="Inventory is empty"
                        description="Record workstations, networking equipment, storage, instruments and more."
                        action={() => newItem('asset')}
                        label="Add your first asset"
                      />
                    )
                  ) : visible.length ? (
                    <div className="entries-grid">
                      {visible.map(recordCard)}
                    </div>
                  ) : (
                    <Empty
                      icon={
                        page === 'experiments'
                          ? Beaker
                          : page === 'projects'
                            ? Layers
                            : CircleDollarSign
                      }
                      title={
                        page === 'experiments'
                          ? 'No experiments recorded'
                          : page === 'projects'
                            ? 'No projects yet'
                            : 'Nothing on your wish list'
                      }
                      description="Create a record to begin documenting this area of your lab."
                      action={() =>
                        newItem(
                          page === 'experiments'
                            ? 'experiment'
                            : page === 'projects'
                              ? 'project'
                              : 'purchase'
                        )
                      }
                      label="Create a record"
                    />
                  )}
                </>
              )}
              {page === 'network' && (
                <>
                  <div className="network-stat-row">
                    <div>
                      <Network size={18} /> <strong>{assets.length}</strong>{' '}
                      documented nodes
                    </div>
                    <div>
                      <Cable size={18} /> <strong>{links.length}</strong> mapped
                      links
                    </div>
                    <div>
                      <ShieldCheck size={18} /> VLAN data is manually entered
                    </div>
                  </div>
                  <section className="panel topology-full">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow">TOPOLOGY EXPLORER</div>
                        <h2>Documented infrastructure</h2>
                      </div>
                      <div className="graph-header-actions">
                        <button
                          className="outline small"
                          onClick={() => newItem('asset')}
                        >
                          <Plus size={14} /> Device
                        </button>
                        <button
                          className="outline small"
                          onClick={() => newItem('link')}
                        >
                          <Link2 size={14} /> Connection
                        </button>
                      </div>
                    </div>
                    <Topology items={items} onNode={setDetail} />
                  </section>
                  <div className="legend-note">
                    <CircleHelp size={16} /> Network graph is a documented
                    model. No hardware discovery, port scans, or automatic
                    connectivity checks are performed.
                  </div>
                  <section className="panel network-link-list">
                    <div className="panel-heading">
                      <h2>Link registry</h2>
                      <span className="subtle">{links.length} documented</span>
                    </div>
                    {links.length ? (
                      links.map(link => (
                        <button
                          key={link.id}
                          className="link-row"
                          onClick={() => setDetail(link)}
                        >
                          <Cable size={17} />
                          <span>
                            {assets.find(a => a.id === link.source)?.title ||
                              'Missing device'}{' '}
                            <em>↔</em>{' '}
                            {assets.find(a => a.id === link.target)?.title ||
                              'Missing device'}
                          </span>
                          <b>{link.speed}</b>
                          <ChevronRight size={15} />
                        </button>
                      ))
                    ) : (
                      <div className="short-empty">
                        No links recorded.{' '}
                        <button onClick={() => newItem('link')}>
                          Add a connection
                        </button>
                      </div>
                    )}
                  </section>
                </>
              )}
              {page === 'telemetry' && (
                <>
                  <div className="monitor-banner">
                    <Radio size={19} />
                    <div>
                      <strong>Manual / sample monitoring mode</strong>
                      <p>
                        No telemetry agent is installed. Values are entered by
                        you or loaded from an explicitly labeled demo
                        workspace—not live device measurements.
                      </p>
                    </div>
                    <span>NO LIVE FEED</span>
                  </div>
                  {assets.length ? (
                    <>
                      <div className="monitor-select">
                        <label htmlFor="device-select">SELECT DEVICE</label>
                        <select
                          id="device-select"
                          value={
                            selectedDevice &&
                            assets.some(a => a.id === selectedDevice)
                              ? selectedDevice
                              : assets[0].id
                          }
                          onChange={e => setSelectedDevice(e.target.value)}
                        >
                          {assets.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      {(() => {
                        const selected =
                          selectedDevice &&
                          assets.some(a => a.id === selectedDevice)
                            ? selectedDevice
                            : assets[0].id;
                        const readings = metrics
                          .filter(m => m.source === selected)
                          .sort((a, b) =>
                            b.createdAt.localeCompare(a.createdAt)
                          );
                        const current = readings[0];
                        const selectedAsset = assets.find(
                          a => a.id === selected
                        )!;
                        return (
                          <>
                            <div className="monitor-title">
                              <span className="device-symbol">
                                {categoryIcon(selectedAsset.category)}
                              </span>
                              <div>
                                <h2>{selectedAsset.title}</h2>
                                <p>
                                  {current
                                    ? (current.origin === 'demo'
                                        ? 'Example measurement'
                                        : 'Manually entered measurement') +
                                      ' · ' +
                                      shortDate(current.updatedAt)
                                    : 'No recorded measurements'}
                                </p>
                              </div>
                              <StatusPill value={selectedAsset.status} />
                            </div>
                            <div className="monitor-metrics">
                              {[
                                {
                                  label: 'CPU LOAD',
                                  value: current?.cpuPct,
                                  suffix: '%',
                                  icon: Cpu,
                                },
                                {
                                  label: 'MEMORY',
                                  value: current?.ramPct,
                                  suffix: '%',
                                  icon: Database,
                                },
                                {
                                  label: 'DISK UTILIZATION',
                                  value: current?.diskPct,
                                  suffix: '%',
                                  icon: HardDrive,
                                },
                                {
                                  label: 'CPU TEMPERATURE',
                                  value: current?.temperature,
                                  suffix: '°C',
                                  icon: Gauge,
                                },
                              ].map(m => (
                                <div className="monitor-card" key={m.label}>
                                  <div>
                                    <span>{m.label}</span>
                                    <m.icon size={19} />
                                  </div>
                                  <strong>
                                    {current ? m.value + m.suffix : '—'}
                                  </strong>
                                  <div className="monitor-meter">
                                    <span
                                      style={{
                                        width: current
                                          ? Math.max(
                                              1,
                                              Math.min(100, Number(m.value))
                                            ) + '%'
                                          : '0%',
                                      }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="monitor-lower">
                              <section className="panel">
                                <div className="panel-heading">
                                  <div>
                                    <div className="eyebrow">
                                      MEASUREMENT HISTORY
                                    </div>
                                    <h2>Recorded CPU load</h2>
                                  </div>
                                  <span className="tag-warning">
                                    {current?.origin === 'demo'
                                      ? 'SAMPLE'
                                      : 'MANUAL'}
                                  </span>
                                </div>
                                <MiniBars readings={readings} />
                              </section>
                              <section className="panel">
                                <div className="panel-heading">
                                  <h2>Device details</h2>
                                </div>
                                <div className="fact-rows">
                                  <div>
                                    <span>Hostname</span>
                                    <b>{selectedAsset.hostname || '—'}</b>
                                  </div>
                                  <div>
                                    <span>VLAN</span>
                                    <b>{selectedAsset.vlan || '—'}</b>
                                  </div>
                                  <div>
                                    <span>Interface</span>
                                    <b>{selectedAsset.network || '—'}</b>
                                  </div>
                                  <div>
                                    <span>Recorded throughput</span>
                                    <b>
                                      {current
                                        ? current.throughput + ' Mb/s'
                                        : '—'}
                                    </b>
                                  </div>
                                  <div>
                                    <span>Sample count</span>
                                    <b>{readings.length}</b>
                                  </div>
                                </div>
                              </section>
                            </div>
                          </>
                        );
                      })()}
                    </>
                  ) : (
                    <Empty
                      icon={Activity}
                      title="No systems to monitor"
                      description="First add a documented asset. Measurements can then be entered manually."
                      action={() => newItem('asset')}
                      label="Add asset"
                    />
                  )}
                </>
              )}
            </>
          )}
          {cursor && (
            <div className="load-more">
              <button
                className="outline"
                disabled={loading}
                onClick={() => void load(cursor)}
              >
                {loading ? 'Loading…' : 'Load more records'}
              </button>
            </div>
          )}
          <footer className="footer">
            <div>
              <Terminal size={15} /> LABOS / V1.0
            </div>
            <span>
              Documentation and manual/simulated data only · No connected
              hardware agent
            </span>
          </footer>
        </main>
      </div>
      {inspected && (
        <div className="drawer-backdrop" onClick={() => setDetail(null)}>
          <aside className="inspector" onClick={e => e.stopPropagation()}>
            <header>
              <span>RECORD INSPECTOR</span>
              <button
                aria-label="Close details"
                onClick={() => setDetail(null)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="inspector-content">
              <span className="entry-category">
                {kindNames[inspected.kind]} /{' '}
                {inspected.origin === 'demo' ? 'DEMO' : 'MANUAL'}
              </span>
              <h2>{inspected.title}</h2>
              <StatusPill value={inspected.status} />
              <p className="inspector-description">
                {inspected.description || 'No additional notes recorded.'}
              </p>
              {inspected.kind === 'asset' && (
                <div className="inspector-section">
                  <h4>HARDWARE / NETWORK</h4>
                  {[
                    ['Category', inspected.category],
                    ['Hostname', inspected.hostname],
                    ['IP address', inspected.ip],
                    ['VLAN', inspected.vlan],
                    ['Processor', inspected.cpu],
                    ['GPU', inspected.gpu],
                    ['Memory', inspected.ram],
                    ['Storage', inspected.storage],
                    ['OS', inspected.os],
                    ['Network', inspected.network],
                    ['Location', inspected.location],
                    [
                      'Estimated power',
                      inspected.watts ? inspected.watts + ' W' : '—',
                    ],
                  ].map(([label, value]) => (
                    <div className="fact" key={label}>
                      <span>{label}</span>
                      <strong>{value || '—'}</strong>
                    </div>
                  ))}
                </div>
              )}
              {inspected.kind === 'link' && (
                <div className="inspector-section">
                  <h4>CONNECTION</h4>
                  <p>
                    {assets.find(a => a.id === inspected.source)?.title ||
                      'Missing device'}{' '}
                    ↔{' '}
                    {assets.find(a => a.id === inspected.target)?.title ||
                      'Missing device'}
                  </p>
                  <p>Link type: {inspected.speed}</p>
                </div>
              )}
              {inspected.kind === 'project' && (
                <div className="inspector-section">
                  <h4>PROJECT TASKS</h4>
                  <div className="progress-row">
                    <div className="progress-track">
                      <div style={{ width: inspected.progress + '%' }} />
                    </div>
                    <b>{inspected.progress}%</b>
                  </div>
                  {inspected.tasks ? (
                    <ul>
                      {inspected.tasks
                        .split('\n')
                        .filter(Boolean)
                        .map((task, i) => (
                          <li key={i}>{task}</li>
                        ))}
                    </ul>
                  ) : (
                    <p>No tasks recorded.</p>
                  )}
                </div>
              )}
              {inspected.kind === 'experiment' && (
                <div className="inspector-section">
                  <h4>LAB NOTEBOOK</h4>
                  {[
                    ['Objective', inspected.objective],
                    ['Procedure', inspected.procedure],
                    ['Observations', inspected.observations],
                    ['Results', inspected.results],
                  ].map(([label, value]) => (
                    <div className="note-section" key={label}>
                      <b>{label}</b>
                      <p>{value || 'Not documented'}</p>
                    </div>
                  ))}
                </div>
              )}
              {inspected.kind === 'purchase' && (
                <div className="inspector-section">
                  <h4>PROCUREMENT</h4>
                  <div className="fact">
                    <span>Estimate</span>
                    <strong>{money(inspected.price)}</strong>
                  </div>
                  <div className="fact">
                    <span>Target price</span>
                    <strong>{money(inspected.targetPrice)}</strong>
                  </div>
                  <div className="fact">
                    <span>Priority</span>
                    <strong>{inspected.priority}</strong>
                  </div>
                </div>
              )}
              {inspected.kind === 'metric' && (
                <div className="inspector-section">
                  <h4>RECORDED METRICS</h4>
                  {[
                    ['CPU', inspected.cpuPct + '%'],
                    ['RAM', inspected.ramPct + '%'],
                    ['Disk', inspected.diskPct + '%'],
                    ['Temperature', inspected.temperature + '°C'],
                    ['Throughput', inspected.throughput + ' Mb/s'],
                  ].map(([l, v]) => (
                    <div className="fact" key={l}>
                      <span>{l}</span>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>
              )}
              <div className="inspector-section">
                <h4>AUDIT INFORMATION</h4>
                <div className="fact">
                  <span>Origin</span>
                  <strong>
                    {inspected.origin === 'demo'
                      ? 'Fictional example'
                      : 'User entry'}
                  </strong>
                </div>
                <div className="fact">
                  <span>Created</span>
                  <strong>{shortDate(inspected.createdAt)}</strong>
                </div>
                <div className="fact">
                  <span>Last updated</span>
                  <strong>{shortDate(inspected.updatedAt)}</strong>
                </div>
              </div>
            </div>
            <footer>
              <button className="outline" onClick={() => editItem(inspected)}>
                <Pencil size={16} /> Edit record
              </button>
              <button className="danger" onClick={() => void remove(inspected)}>
                <Trash2 size={16} /> Delete
              </button>
            </footer>
          </aside>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={() => !saving && setModal(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={(editId ? 'Edit ' : 'New ') + kindNames[modal]}
            onClick={e => e.stopPropagation()}
          >
            <header>
              <div>
                <div className="eyebrow">LABOS / RECORD EDITOR</div>
                <h2>
                  {editId ? 'Edit ' : 'Add '}
                  {kindNames[modal].toLowerCase()}
                </h2>
              </div>
              <button
                aria-label="Close editor"
                disabled={saving}
                onClick={() => setModal(null)}
              >
                <X size={21} />
              </button>
            </header>
            <form onSubmit={save}>
              <div className="modal-fields">
                {fieldTypes[modal].map(field => (
                  <label
                    className={
                      'field ' + (field.type === 'textarea' ? 'full' : '')
                    }
                    key={field.name}
                  >
                    <span>
                      {field.label}
                      {field.name === 'title' ? ' *' : ''}
                    </span>
                    {field.type === 'textarea' ? (
                      <textarea
                        rows={4}
                        value={String(form[field.name] ?? '')}
                        onChange={e =>
                          setForm({ ...form, [field.name]: e.target.value })
                        }
                        placeholder={'Enter ' + field.label.toLowerCase() + '…'}
                      />
                    ) : field.type === 'device' ? (
                      <select
                        value={String(form[field.name] ?? '')}
                        onChange={e =>
                          setForm({ ...form, [field.name]: e.target.value })
                        }
                      >
                        <option value="">Select a device</option>
                        {assets.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.title}
                          </option>
                        ))}
                      </select>
                    ) : field.choices ? (
                      <select
                        value={String(form[field.name] ?? '')}
                        onChange={e =>
                          setForm({ ...form, [field.name]: e.target.value })
                        }
                      >
                        {field.choices.map(choice => (
                          <option key={choice}>{choice}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        step={field.type === 'number' ? 'any' : undefined}
                        min={
                          field.type === 'number' &&
                          field.name !== 'temperature'
                            ? 0
                            : undefined
                        }
                        value={String(form[field.name] ?? '')}
                        onChange={e =>
                          setForm({
                            ...form,
                            [field.name]:
                              field.type === 'number'
                                ? Number(e.target.value)
                                : e.target.value,
                          })
                        }
                        autoFocus={field.name === 'title'}
                        placeholder={
                          field.name === 'title'
                            ? 'Enter a descriptive name'
                            : undefined
                        }
                      />
                    )}
                  </label>
                ))}
                {formError && <div className="form-error">{formError}</div>}
              </div>
              <footer>
                <button
                  type="button"
                  className="outline"
                  onClick={() => setModal(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={saving}>
                  {saving
                    ? 'Saving…'
                    : editId
                      ? 'Save changes'
                      : 'Create record'}{' '}
                  <ArrowRight size={16} />
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
