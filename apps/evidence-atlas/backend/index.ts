import {
  router,
  json,
  error,
  requireAuth,
  db,
  storage,
  isAppDatabaseError,
} from '@appdeploy/sdk';

type Kind = 'source' | 'claim' | 'hypothesis' | 'edge';
type AtlasRecord = {
  id?: string;
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

const tableOf = (userId: string) =>
  'atlas_' + userId.replace(/[^A-Za-z0-9]/g, '');
const str = (value: unknown, max = 2000) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const kinds: Kind[] = ['source', 'claim', 'hypothesis', 'edge'];
const relations = [
  'supports',
  'contradicts',
  'depends on',
  'extends',
  'related to',
];
const allowedStatus = [
  'open',
  'investigating',
  'supported',
  'contested',
  'resolved',
];
const allowedQuality = ['unassessed', 'low', 'moderate', 'high'];
const isId = (value: string) => /^[A-Za-z0-9-]{8,80}$/.test(value);

function normalize(body: unknown, existing?: AtlasRecord): AtlasRecord | null {
  const input = (body || {}) as Record<string, unknown>;
  const kind = (existing?.kind || input.kind) as Kind;
  if (!kinds.includes(kind)) return null;
  const title = str(input.title, 240);
  if (!title || (kind === 'edge' && !str(input.from, 80))) return null;
  const url = str(input.url, 1000);
  if (url && !/^https:\/\//i.test(url)) return null;
  const relation = relations.includes(str(input.relation))
    ? str(input.relation)
    : 'supports';
  const quality = allowedQuality.includes(str(input.quality))
    ? str(input.quality)
    : 'unassessed';
  const status = allowedStatus.includes(str(input.status))
    ? str(input.status)
    : 'open';
  const confidence = Number(input.confidence);
  const filePath = str(input.filePath, 300);
  return {
    kind,
    title,
    summary: str(input.summary, 8000),
    authors: str(input.authors, 700),
    doi: str(input.doi, 250),
    url,
    year: str(input.year, 10),
    tags: str(input.tags, 500),
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(100, confidence))
      : 50,
    quality,
    status,
    relation,
    from: str(input.from, 80),
    to: str(input.to, 80),
    filePath,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provenance: 'Researcher-entered',
  };
}

async function checkEdge(table: string, record: AtlasRecord) {
  if (record.kind !== 'edge') return true;
  if (!isId(record.from) || !isId(record.to) || record.from === record.to)
    return false;
  const [a, b] = await db.get<AtlasRecord>(table, [record.from, record.to], {
    consistent: true,
  });
  return Boolean(a && b && a.kind !== 'edge' && b.kind !== 'edge');
}

function backendFailure(err: unknown) {
  console.error('Evidence Atlas request failed', err);
  if (isAppDatabaseError(err) && err.code === 'AppDatabaseQuotaExceeded') {
    return error(
      'Database quota exceeded. Try again after your quota resets.',
      429
    );
  }
  return error(
    'The operation could not be completed. Please retry or refresh.',
    500
  );
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ ok: true })],
  'GET /api/records': [
    requireAuth(),
    async ctx => {
      try {
        const table = tableOf(ctx.user!.userId);
        const cursor = ctx.query.cursor || undefined;
        const data = await db.list<AtlasRecord>(table, {
          limit: 200,
          ...(cursor ? { nextToken: cursor } : {}),
        });
        return json({ records: data.items, nextToken: data.nextToken || null });
      } catch (err) {
        return backendFailure(err);
      }
    },
  ],
  'POST /api/records': [
    requireAuth(),
    async ctx => {
      try {
        const body = (ctx.body || {}) as Record<string, unknown>;
        const id = str(body.id, 80);
        if (!isId(id)) return error('A valid request ID is required.', 400);
        const record = normalize(body);
        if (!record)
          return error(
            'A title and valid record details are required. URLs must use HTTPS.',
            400
          );
        if (
          record.filePath &&
          (record.kind !== 'source' ||
            !record.filePath.startsWith(ctx.user!.userId + '/'))
        ) {
          return error('Invalid attachment path.', 400);
        }
        const table = tableOf(ctx.user!.userId);
        if (!(await checkEdge(table, record)))
          return error('Choose two existing, distinct graph nodes.', 400);
        let created: string | null = null;
        try {
          [created] = await db.tx.add(table, [{ ...record, id }]);
        } catch (err) {
          if (
            !isAppDatabaseError(err) ||
            !['AppDatabaseDuplicateId', 'AppDatabaseUnknownOutcome'].includes(
              err.code
            )
          )
            throw err;
        }
        if (!created) {
          const [previous] = await db.get<AtlasRecord>(table, [id], {
            consistent: true,
          });
          if (
            previous &&
            previous.title === record.title &&
            previous.kind === record.kind
          )
            return json({ record: { ...previous, id } });
          return error(
            'Record ID conflict or uncertain save. Refresh and check your records.',
            409
          );
        }
        return json({ record: { ...record, id } }, 201);
      } catch (err) {
        return backendFailure(err);
      }
    },
  ],
  'PUT /api/records/:id': [
    requireAuth(),
    async ctx => {
      try {
        const id = ctx.params.id;
        if (!isId(id)) return error('Invalid record ID.', 400);
        const table = tableOf(ctx.user!.userId);
        const [previous] = await db.get<AtlasRecord>(table, [id], {
          consistent: true,
        });
        if (!previous) return error('Record not found.', 404);
        const record = normalize(ctx.body, previous);
        if (!record) return error('Provide valid record details.', 400);
        if (
          record.filePath &&
          (record.kind !== 'source' ||
            !record.filePath.startsWith(ctx.user!.userId + '/'))
        )
          return error('Invalid attachment path.', 400);
        if (!(await checkEdge(table, record)))
          return error('Invalid graph connection.', 400);
        const [ok] = await db.tx.update(table, [{ id, record }], {
          patch: true,
        });
        if (!ok) return error('Record changed or no longer exists.', 409);
        return json({ record: { ...record, id } });
      } catch (err) {
        return backendFailure(err);
      }
    },
  ],
  'DELETE /api/records/:id': [
    requireAuth(),
    async ctx => {
      try {
        const table = tableOf(ctx.user!.userId);
        const id = ctx.params.id;
        if (!isId(id)) return error('Invalid record ID.', 400);
        const [previous] = await db.get<AtlasRecord>(table, [id], {
          consistent: true,
        });
        if (!previous) return error('Record not found.', 404);
        const [ok] = await db.delete(table, [id]);
        if (!ok) return error('Unable to delete the record.', 409);
        if (
          previous.filePath &&
          previous.filePath.startsWith(ctx.user!.userId + '/')
        ) {
          try {
            await storage.delete([previous.filePath]);
          } catch (err) {
            console.warn('Attachment cleanup pending', err);
          }
        }
        try {
          const linked = await db.list<AtlasRecord>(table, { limit: 250 });
          const ids = linked.items
            .filter(
              item =>
                item.kind === 'edge' && (item.from === id || item.to === id)
            )
            .map(item => item.id);
          if (ids.length) await db.delete(table, ids);
        } catch (err) {
          console.warn('Edge cleanup pending', err);
        }
        return json({ deleted: true });
      } catch (err) {
        return backendFailure(err);
      }
    },
  ],
  'POST /api/files': [
    requireAuth(),
    async ctx => {
      try {
        const body = (ctx.body || {}) as Record<string, unknown>;
        const id = str(body.id, 80);
        const content = str(body.content, 1500000);
        if (
          !isId(id) ||
          typeof body.content !== 'string' ||
          body.content.length > 1500000 ||
          !/^[A-Za-z0-9+/=]+$/.test(content)
        ) {
          return error(
            'Invalid PDF. Maximum supported size is about 1 MB.',
            400
          );
        }
        if (str(body.contentType) !== 'application/pdf')
          return error('Only PDF files are supported.', 400);
        const path = ctx.user!.userId + '/' + id + '.pdf';
        const [ok] = await storage.write([
          { path, content, contentType: 'application/pdf' },
        ]);
        if (!ok) return error('Upload failed.', 500);
        return json({ filePath: path });
      } catch (err) {
        return backendFailure(err);
      }
    },
  ],
  'GET /api/file-url/:id': [
    requireAuth(),
    async ctx => {
      try {
        const table = tableOf(ctx.user!.userId);
        const [record] = await db.get<AtlasRecord>(table, [ctx.params.id], {
          consistent: true,
        });
        if (
          !record ||
          record.kind !== 'source' ||
          !record.filePath ||
          !record.filePath.startsWith(ctx.user!.userId + '/')
        ) {
          return error('Attachment not found.', 404);
        }
        const urls = await storage.url([record.filePath]);
        return json({ url: urls[0]?.url || '' });
      } catch (err) {
        return backendFailure(err);
      }
    },
  ],
});
