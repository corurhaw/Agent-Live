import {
  router,
  json,
  error,
  requireAuth,
  db,
  isAppDatabaseError,
} from '@appdeploy/sdk';

type Kind = 'asset' | 'link' | 'experiment' | 'project' | 'purchase' | 'metric';
type LabRecord = {
  id?: string;
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
const kinds: Kind[] = [
  'asset',
  'link',
  'experiment',
  'project',
  'purchase',
  'metric',
];
const safeTable = (userId: string) =>
  'labos_' + userId.replace(/[^A-Za-z0-9]/g, '');
const text = (value: unknown, size = 2000) =>
  typeof value === 'string' ? value.trim().slice(0, size) : '';
const num = (value: unknown, min: number, max: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
};
const validId = (value: string) => /^[a-zA-Z0-9-]{8,80}$/.test(value);

function normalize(data: unknown, existing?: LabRecord): LabRecord | null {
  const value = (data || {}) as Record<string, unknown>;
  const kind = (existing?.kind || value.kind) as Kind;
  const title = text(value.title, 200);
  if (!kinds.includes(kind) || !title) return null;
  return {
    kind,
    title,
    description: text(value.description, 6000),
    category: text(value.category, 100),
    status: text(value.status, 70) || 'Planned',
    priority: text(value.priority, 40) || 'Medium',
    location: text(value.location, 140),
    hostname: text(value.hostname, 180),
    ip: text(value.ip, 100),
    vlan: text(value.vlan, 70),
    cpu: text(value.cpu, 180),
    gpu: text(value.gpu, 180),
    ram: text(value.ram, 100),
    storage: text(value.storage, 180),
    os: text(value.os, 120),
    network: text(value.network, 120),
    watts: num(value.watts, 0, 200000),
    source: text(value.source, 80),
    target: text(value.target, 80),
    speed: text(value.speed, 80),
    objective: text(value.objective, 6000),
    procedure: text(value.procedure, 6000),
    observations: text(value.observations, 6000),
    results: text(value.results, 6000),
    tasks: text(value.tasks, 5000),
    progress: num(value.progress, 0, 100),
    price: num(value.price, 0, 100000000),
    targetPrice: num(value.targetPrice, 0, 100000000),
    cpuPct: num(value.cpuPct, 0, 100),
    ramPct: num(value.ramPct, 0, 100),
    diskPct: num(value.diskPct, 0, 100),
    temperature: num(value.temperature, -100, 300),
    throughput: num(value.throughput, 0, 1000000),
    origin: 'manual',
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function validReferences(table: string, record: LabRecord) {
  if (record.kind === 'link') {
    if (
      !validId(record.source) ||
      !validId(record.target) ||
      record.source === record.target
    )
      return false;
    const [a, b] = await db.get<LabRecord>(
      table,
      [record.source, record.target],
      { consistent: true }
    );
    return Boolean(a && b && a.kind === 'asset' && b.kind === 'asset');
  }
  if (record.kind === 'metric') {
    if (!validId(record.source)) return false;
    const [a] = await db.get<LabRecord>(table, [record.source], {
      consistent: true,
    });
    return a?.kind === 'asset';
  }
  return true;
}
function fault(err: unknown) {
  console.error('LabOS backend operation failed', err);
  if (isAppDatabaseError(err) && err.code === 'AppDatabaseQuotaExceeded')
    return error(
      'Database quota exceeded. Please try after your quota resets.',
      429
    );
  return error(
    'Unable to complete the operation. Please retry or refresh.',
    500
  );
}
async function scopedList(table: string, cursor?: string) {
  return db.list<LabRecord>(table, {
    limit: 180,
    ...(cursor ? { nextToken: cursor } : {}),
  });
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ ok: true })],
  'GET /api/records': [
    requireAuth(),
    async ctx => {
      try {
        const result = await scopedList(
          safeTable(ctx.user!.userId),
          ctx.query.cursor
        );
        return json({
          records: result.items,
          nextToken: result.nextToken || null,
        });
      } catch (e) {
        return fault(e);
      }
    },
  ],
  'POST /api/records': [
    requireAuth(),
    async ctx => {
      try {
        const input = (ctx.body || {}) as Record<string, unknown>;
        const id = text(input.id, 80);
        if (!validId(id)) return error('Invalid operation ID.', 400);
        const record = normalize(ctx.body);
        if (!record)
          return error('A valid title and category are required.', 400);
        const table = safeTable(ctx.user!.userId);
        if (!(await validReferences(table, record)))
          return error(
            'Select valid devices for the connection or reading.',
            400
          );
        let created: string | null = null;
        try {
          [created] = await db.tx.add(table, [{ ...record, id }]);
        } catch (e) {
          if (
            !isAppDatabaseError(e) ||
            (e.code !== 'AppDatabaseDuplicateId' &&
              e.code !== 'AppDatabaseUnknownOutcome')
          )
            throw e;
        }
        if (!created) {
          const [prior] = await db.get<LabRecord>(table, [id], {
            consistent: true,
          });
          if (
            prior &&
            prior.kind === record.kind &&
            prior.title === record.title
          )
            return json({ record: { ...prior, id } });
          return error(
            'Save status uncertain or ID conflict. Refresh the page before retrying.',
            409
          );
        }
        return json({ record: { ...record, id } }, 201);
      } catch (e) {
        return fault(e);
      }
    },
  ],
  'PUT /api/records/:id': [
    requireAuth(),
    async ctx => {
      try {
        const table = safeTable(ctx.user!.userId);
        const id = ctx.params.id;
        if (!validId(id)) return error('Invalid record ID.', 400);
        const [previous] = await db.get<LabRecord>(table, [id], {
          consistent: true,
        });
        if (!previous) return error('Record not found.', 404);
        const updated = normalize(ctx.body, previous);
        if (!updated) return error('Please provide valid record details.', 400);
        if (!(await validReferences(table, updated)))
          return error('Invalid reference to a device.', 400);
        const [saved] = await db.tx.update(
          table,
          [{ id, record: { ...updated, origin: previous.origin } }],
          { patch: true }
        );
        if (!saved) return error('Could not save changes.', 409);
        return json({ record: { ...updated, id, origin: previous.origin } });
      } catch (e) {
        return fault(e);
      }
    },
  ],
  'DELETE /api/records/:id': [
    requireAuth(),
    async ctx => {
      try {
        const table = safeTable(ctx.user!.userId);
        const id = ctx.params.id;
        if (!validId(id)) return error('Invalid record ID.', 400);
        const [previous] = await db.get<LabRecord>(table, [id], {
          consistent: true,
        });
        if (!previous) return error('Record not found.', 404);
        if (previous.kind === 'asset') {
          const page = await scopedList(table);
          const links = page.items
            .filter(
              item =>
                (item.kind === 'link' &&
                  (item.source === id || item.target === id)) ||
                (item.kind === 'metric' && item.source === id)
            )
            .map(item => item.id);
          if (links.length) await db.delete(table, links);
        }
        const [deleted] = await db.delete(table, [id]);
        if (!deleted) return error('Could not delete record.', 409);
        return json({ deleted: true });
      } catch (e) {
        return fault(e);
      }
    },
  ],
  'POST /api/demo': [
    requireAuth(),
    async ctx => {
      try {
        const table = safeTable(ctx.user!.userId);
        const page = await scopedList(table);
        if (page.items.length > 0)
          return error(
            'Example data is available only for an empty workspace.',
            409
          );
        const stamp = new Date().toISOString();
        const mk = (
          id: string,
          kind: Kind,
          title: string,
          patch: Record<string, unknown>
        ) => ({
          id,
          ...normalize({ kind, title, ...patch })!,
          origin: 'demo',
          createdAt: stamp,
          updatedAt: stamp,
        });
        const records = [
          mk('demo-device-router', 'asset', 'Core Gateway', {
            category: 'Router',
            status: 'Documented',
            hostname: 'edge-gw.lab',
            ip: '192.168.10.1',
            vlan: '10 · Management',
            network: '10 GbE',
            location: 'Rack A',
            watts: 35,
            description:
              'Illustrative network gateway — not connected to a real device.',
          }),
          mk('demo-device-switch', 'asset', '10GbE Managed Switch', {
            category: 'Switch',
            status: 'Documented',
            hostname: 'core-sw.lab',
            ip: '192.168.10.2',
            vlan: '10 · Management',
            network: '10 GbE',
            location: 'Rack A',
            watts: 45,
          }),
          mk('demo-device-workstation', 'asset', 'Engineering Workstation', {
            category: 'Workstation',
            status: 'Documented',
            hostname: 'dev-01.lab',
            ip: '192.168.20.10',
            vlan: '20 · Compute',
            cpu: 'Ryzen 9',
            ram: '64 GB DDR5',
            gpu: 'Discrete GPU',
            storage: '2 TB NVMe',
            os: 'Linux',
            network: '10 GbE',
            watts: 220,
            location: 'Desk 1',
          }),
          mk('demo-device-nas', 'asset', 'Research NAS', {
            category: 'NAS',
            status: 'Documented',
            hostname: 'nas-01.lab',
            ip: '192.168.30.10',
            vlan: '30 · Storage',
            storage: '24 TB',
            network: '10 GbE',
            location: 'Rack A',
            watts: 85,
          }),
          mk('demo-device-fpga', 'asset', 'FPGA Development Board', {
            category: 'Development',
            status: 'Documented',
            hostname: 'fpga-01.lab',
            ip: '192.168.40.10',
            vlan: '40 · Lab',
            location: 'Electronics bench',
            watts: 18,
          }),
          mk('demo-link-001', 'link', 'Gateway ↔ Switch', {
            source: 'demo-device-router',
            target: 'demo-device-switch',
            speed: '10 GbE',
          }),
          mk('demo-link-002', 'link', 'Switch ↔ Workstation', {
            source: 'demo-device-switch',
            target: 'demo-device-workstation',
            speed: '10 GbE',
          }),
          mk('demo-link-003', 'link', 'Switch ↔ NAS', {
            source: 'demo-device-switch',
            target: 'demo-device-nas',
            speed: '10 GbE',
          }),
          mk('demo-link-004', 'link', 'Switch ↔ FPGA', {
            source: 'demo-device-switch',
            target: 'demo-device-fpga',
            speed: '1 GbE',
          }),
          mk('demo-project-001', 'project', 'Isolated management VLAN', {
            status: 'In progress',
            priority: 'High',
            progress: 40,
            description:
              'Design a management network isolated from the research and storage VLANs.',
            tasks:
              'Define VLAN membership\nConfigure switch ports\nDocument firewall boundaries\nValidate isolation',
          }),
          mk('demo-project-002', 'project', 'Remote lab console', {
            status: 'Planning',
            priority: 'Medium',
            progress: 15,
            description:
              'Document KVM and local console access for several systems.',
            tasks:
              'Identify host interfaces\nEvaluate KVM architecture\nTest local remote console',
          }),
          mk(
            'demo-experiment-001',
            'experiment',
            'PWM temperature control bench',
            {
              category: 'Embedded systems',
              status: 'Draft',
              objective:
                'Compare PID parameter selections for thermal regulation.',
              procedure:
                'Record baseline; vary gain parameters; observe settling and overshoot.',
              observations: 'No measurements yet. Example notebook entry.',
              results: 'Pending',
            }
          ),
          mk('demo-purchase-001', 'purchase', 'White 16 GB graphics card', {
            category: 'GPU',
            status: 'Considering',
            priority: 'High',
            price: 749,
            targetPrice: 699,
            description: 'Illustrative procurement entry; pricing is not live.',
          }),
          mk('demo-purchase-002', 'purchase', '10GbE network adapter', {
            category: 'Networking',
            status: 'Considering',
            priority: 'Medium',
            price: 95,
            targetPrice: 80,
          }),
          mk('demo-metric-001', 'metric', 'Workstation sample reading', {
            source: 'demo-device-workstation',
            cpuPct: 34,
            ramPct: 47,
            diskPct: 62,
            temperature: 51,
            throughput: 185,
            description: 'Example data only; not collected from hardware.',
          }),
        ];
        const saved = await db.tx.add(table, records);
        if (saved.some(item => !item))
          return error(
            'Example data could not be installed completely. Refresh before retrying.',
            409
          );
        return json({ records }, 201);
      } catch (e) {
        return fault(e);
      }
    },
  ],
});
