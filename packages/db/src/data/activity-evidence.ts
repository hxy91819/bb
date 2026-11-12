import { and, eq, gt, lt, sql, type SQL } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { events, projects, threadPluginMetadata, threads } from "../schema.js";

export type ActivityKind = 'acceptedInput' | 'completedTurn' | 'agentMessage' | 'commandExecution' | 'fileChange' | 'toolCall';
export type ActivityStatus = 'accepted' | 'statement' | 'pending' | 'completed' | 'failed' | 'interrupted' | 'unknown';

export interface ActivityFilter {
  metadata: { pluginId: string; key: string; equals: string | number | boolean | null };
  from: number;
  to: number;
  projectId?: string;
  threadId?: string;
}

export function eventSequenceRange(args: {
  threadId: string;
  afterSequence?: number;
  beforeSequence?: number;
}): SQL | undefined {
  return and(eq(events.threadId, args.threadId),
    args.afterSequence === undefined ? undefined : gt(events.sequence, args.afterSequence),
    args.beforeSequence === undefined ? undefined : lt(events.sequence, args.beforeSequence));
}

const safeData = sql`CASE WHEN json_valid(${events.data}) THEN ${events.data} ELSE '{}' END`;
const itemType = sql<string>`json_extract(${safeData}, '$.item.type')`;
export const activityKind = sql<ActivityKind>`CASE ${events.type}
  WHEN 'turn/input/accepted' THEN 'acceptedInput'
  WHEN 'turn/completed' THEN 'completedTurn'
  ELSE ${itemType} END`;
export const activityStatus = sql<ActivityStatus>`CASE
  WHEN ${events.type} = 'turn/input/accepted' THEN 'accepted'
  WHEN ${events.type} = 'item/completed' AND ${itemType} = 'agentMessage' THEN 'statement'
  WHEN ${events.type} = 'turn/completed' AND json_extract(${safeData}, '$.status') IN ('completed','failed','interrupted') THEN json_extract(${safeData}, '$.status')
  WHEN ${events.type} = 'item/completed' AND json_extract(${safeData}, '$.item.status') IN ('pending','completed','failed','interrupted') THEN json_extract(${safeData}, '$.item.status')
  ELSE 'unknown' END`;
const reportable = sql`(${events.type} IN ('turn/input/accepted', 'turn/completed') OR
  (${events.type} = 'item/completed' AND ${itemType} IN ('agentMessage','commandExecution','fileChange','toolCall')))`;
const localBoundary = sql<number | null>`(SELECT min(identity.sequence) FROM events AS identity
  WHERE identity.thread_id = ${threads.id} AND identity.type = 'thread/identity')`;

const missingLocalBoundary = sql`${localBoundary} IS NULL OR
  (SELECT count(*) FROM events AS prefix WHERE prefix.thread_id = ${threads.id}
    AND prefix.sequence < ${localBoundary}) <> ${localBoundary} - 1`;

export function activityThreadWhere(filter: ActivityFilter, asOf: number): SQL {
  const value = filter.metadata.equals;
  const scalarType = value === null ? sql`m.type = 'null'`
    : typeof value === 'number' ? sql`m.type IN ('integer','real') AND m.atom = ${value}`
    : typeof value === 'boolean' ? sql`m.type = ${value ? 'true' : 'false'}`
    : sql`m.type = 'text' AND m.atom = ${value}`;
  return sql`${threadPluginMetadata.pluginId} = ${filter.metadata.pluginId}
    AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(${threadPluginMetadata.metadataJson})
      AND json_type(${threadPluginMetadata.metadataJson}) = 'object' THEN ${threadPluginMetadata.metadataJson} ELSE '{}' END) AS m
      WHERE m.key = ${filter.metadata.key} AND ${scalarType})
    AND ${threads.deletedAt} IS NULL AND ${projects.deletedAt} IS NULL
    AND ${projects.kind} = 'standard' AND ${threads.createdAt} < ${asOf}
    ${filter.projectId === undefined ? sql`` : sql`AND ${threads.projectId} = ${filter.projectId}`}
    ${filter.threadId === undefined ? sql`` : sql`AND ${threads.id} = ${filter.threadId}`}`;
}

export function activityEventWhere(filter: ActivityFilter, asOf: number, throughSequence?: number): SQL {
  return sql`${events.createdAt} >= ${filter.from} AND ${events.createdAt} < ${Math.min(filter.to, asOf)}
    AND ${reportable}
    AND (${threads.originKind} IS NULL OR ${threads.originKind} <> 'fork' OR ${events.sequence} > ${localBoundary})
    ${throughSequence === undefined ? sql`` : sql`AND ${events.sequence} <= ${throughSequence}`}`;
}

function scopeQuery(db: DbQueryConnection, filter: ActivityFilter, asOf: number) {
  return db.select({ threadId: threads.id }).from(threadPluginMetadata)
    .innerJoin(threads, eq(threads.id, threadPluginMetadata.threadId))
    .innerJoin(projects, eq(projects.id, threads.projectId))
    .where(activityThreadWhere(filter, asOf));
}

export function activityForkBoundaryGaps(db: DbQueryConnection, filter: ActivityFilter, asOf: number) {
  const scope = scopeQuery(db, filter, asOf).as("scope");
  const where = sql`${threads.originKind} = 'fork' AND (${missingLocalBoundary})`;
  const counts = db.select({
    count: sql<number>`count(*)`,
    missingIdentityCount: sql<number>`coalesce(sum(CASE WHEN ${localBoundary} IS NULL THEN 1 ELSE 0 END),0)`,
    uncertainPrefixCount: sql<number>`coalesce(sum(CASE WHEN ${localBoundary} IS NOT NULL THEN 1 ELSE 0 END),0)`,
  }).from(scope).innerJoin(threads, eq(threads.id, scope.threadId)).where(where).get();
  const samples = db.select({
    threadId: threads.id, projectId: threads.projectId,
    reason: sql<"missing-local-identity" | "prefix-sequence-gap">`CASE WHEN ${localBoundary} IS NULL THEN 'missing-local-identity' ELSE 'prefix-sequence-gap' END`,
  }).from(scope).innerJoin(threads, eq(threads.id, scope.threadId)).where(where)
    .orderBy(sql`${threads.id} COLLATE BINARY`).limit(10).all();
  return {count: counts?.count??0, missingIdentityCount: counts?.missingIdentityCount??0,
    uncertainPrefixCount: counts?.uncertainPrefixCount??0, samples};
}

export function activityThroughSequence(db: DbQueryConnection, filter: ActivityFilter, asOf: number): number {
  const scope = scopeQuery(db, filter, asOf).as('scope');
  return db.select({ sequence: sql<number>`coalesce(max(${events.sequence}),0)` }).from(scope)
    .innerJoin(events, eq(events.threadId, scope.threadId)).get()?.sequence ?? 0;
}

function evidenceQuery(db: DbQueryConnection, filter: ActivityFilter, asOf: number, throughSequence?: number) {
  return db.select({eventId: events.id}).from(threadPluginMetadata)
    .innerJoin(threads, eq(threads.id, threadPluginMetadata.threadId))
    .innerJoin(projects, eq(projects.id, threads.projectId))
    .innerJoin(events, eq(events.threadId, threads.id))
    .where(and(activityThreadWhere(filter, asOf), activityEventWhere(filter, asOf, throughSequence)));
}

export function countActivityEvidence(db: DbQueryConnection, filter: ActivityFilter, asOf: number, throughSequence?: number): number {
  const query = evidenceQuery(db, filter, asOf, throughSequence).as('evidence');
  return db.select({ count: sql<number>`count(*)` }).from(query).get()?.count ?? 0;
}

const commandText = sql<string>`trim(replace(replace(replace(CASE WHEN json_type(${safeData}, '$.item.command') = 'text'
  THEN json_extract(${safeData}, '$.item.command') ELSE '' END, char(9), ' '), char(10), ' '), char(13), ' '))`;
const commandToken = sql<string>`substr(${commandText},1,instr(${commandText} || ' ',' ')-1)`;
const commandName = sql<string>`CASE WHEN instr(${commandToken},'=') > 0 THEN '(shell)' ELSE substr(${commandToken},1,128) END`;
const excerptText = sql<string>`CASE ${events.type}
  WHEN 'turn/input/accepted' THEN 'Input accepted'
  WHEN 'turn/completed' THEN 'Turn ' || ${activityStatus}
  ELSE CASE ${itemType}
    WHEN 'agentMessage' THEN CASE WHEN json_type(${safeData}, '$.item.text') = 'text' THEN json_extract(${safeData}, '$.item.text') ELSE '' END
    WHEN 'commandExecution' THEN ${commandName}
    WHEN 'fileChange' THEN CASE WHEN json_type(${safeData}, '$.item.changes[0].path') = 'text' THEN json_extract(${safeData}, '$.item.changes[0].path') ELSE '' END
    WHEN 'toolCall' THEN CASE WHEN json_type(${safeData}, '$.item.tool') = 'text' THEN json_extract(${safeData}, '$.item.tool') ELSE '' END
    ELSE '' END END`;
const projection = {
  eventId: events.id, threadId: events.threadId, sequence: events.sequence, createdAt: events.createdAt,
  type: activityKind, status: activityStatus,
  outcome: sql<'exit-zero' | 'exit-nonzero' | 'unknown'>`CASE
    WHEN ${events.type} = 'item/completed' AND ${itemType} = 'commandExecution' AND json_type(${safeData}, '$.item.exitCode') = 'integer'
      THEN CASE WHEN json_extract(${safeData}, '$.item.exitCode') = 0 THEN 'exit-zero' ELSE 'exit-nonzero' END
    ELSE 'unknown' END`,
  excerpt: sql<string>`substr(${excerptText},1,512)`,
  excerptTruncated: sql<number>`CASE WHEN ${events.type} = 'item/completed' AND ${itemType} = 'commandExecution'
    THEN length(${commandToken}) > 128 ELSE length(${excerptText}) > 512 END`,
  commandName: sql<string | null>`CASE WHEN ${events.type} = 'item/completed' AND ${itemType} = 'commandExecution' AND json_type(${safeData}, '$.item.command') = 'text' THEN ${commandName} END`,
  exitCode: sql<number | null>`CASE WHEN ${events.type} = 'item/completed' AND ${itemType} = 'commandExecution' AND json_type(${safeData}, '$.item.exitCode') = 'integer' THEN json_extract(${safeData}, '$.item.exitCode') END`,
  filePath: sql<string | null>`CASE WHEN ${events.type} = 'item/completed' AND ${itemType} = 'fileChange' AND json_type(${safeData}, '$.item.changes[0].path') = 'text' THEN substr(json_extract(${safeData}, '$.item.changes[0].path'),1,256) END`,
};

export function listActivityEvidence(db: DbQueryConnection, args: {
  filter: ActivityFilter; asOf: number; throughSequence?: number; afterSequence?: number; limit: number; order: 'asc' | 'recent';
}) {
  return db.select(projection).from(threadPluginMetadata)
    .innerJoin(threads, eq(threads.id, threadPluginMetadata.threadId))
    .innerJoin(projects, eq(projects.id, threads.projectId))
    .innerJoin(events, eq(events.threadId, threads.id))
    .where(and(activityThreadWhere(args.filter,args.asOf), activityEventWhere(args.filter,args.asOf,args.throughSequence),
      args.afterSequence === undefined ? undefined : gt(events.sequence,args.afterSequence)))
    .orderBy(...(args.order === 'asc' ? [events.sequence] : [sql`${events.createdAt} DESC`,sql`${events.sequence} DESC`]))
    .limit(args.limit).all().map(row => ({...row, excerptTruncated: row.excerptTruncated !== 0}));
}

export function activityCounts(db: DbQueryConnection, filter: ActivityFilter, asOf: number) {
  const counts = db.select({ type: activityKind, status: activityStatus, count: sql<number>`count(*)` })
    .from(threadPluginMetadata).innerJoin(threads, eq(threads.id, threadPluginMetadata.threadId))
    .innerJoin(projects,eq(projects.id,threads.projectId)).innerJoin(events,eq(events.threadId,threads.id))
    .where(and(activityThreadWhere(filter,asOf),activityEventWhere(filter,asOf)))
    .groupBy(activityKind,activityStatus).orderBy(activityKind,activityStatus).all();
  const counters = db.select({
    acceptedInputs: sql<number>`coalesce(sum(CASE WHEN ${events.type} = 'turn/input/accepted' THEN 1 ELSE 0 END),0)`,
    completedTurns: sql<number>`coalesce(sum(CASE WHEN ${events.type} = 'turn/completed' THEN 1 ELSE 0 END),0)`,
  }).from(threadPluginMetadata).innerJoin(threads,eq(threads.id,threadPluginMetadata.threadId))
    .innerJoin(projects,eq(projects.id,threads.projectId)).innerJoin(events,eq(events.threadId,threads.id))
    .where(and(activityThreadWhere(filter,asOf),activityEventWhere(filter,asOf))).get();
  return {counts,acceptedInputs:counters?.acceptedInputs??0,completedTurns:counters?.completedTurns??0};
}

export function activitySummaryPage(db: DbQueryConnection, args: { filter: ActivityFilter; asOf: number; afterThreadId?: string; limit: number }) {
  const where = and(activityThreadWhere(args.filter,args.asOf),activityEventWhere(args.filter,args.asOf));
  const grouped = db.select({ threadId: threads.id }).from(threadPluginMetadata)
    .innerJoin(threads,eq(threads.id,threadPluginMetadata.threadId)).innerJoin(projects,eq(projects.id,threads.projectId))
    .innerJoin(events,eq(events.threadId,threads.id)).where(where).groupBy(sql`${threadPluginMetadata.threadId} COLLATE BINARY`).as('matched');
  const total = db.select({ count: sql<number>`count(*)` }).from(grouped).get()?.count ?? 0;
  const rows = db.select({ threadId: threads.id, projectId: threads.projectId,
    title: sql<string>`substr(coalesce(${threads.title},${threads.titleFallback},${threads.id}),1,200)`,
    lastActivityAt: sql<number>`max(${events.createdAt})` }).from(threadPluginMetadata)
    .innerJoin(threads,eq(threads.id,threadPluginMetadata.threadId)).innerJoin(projects,eq(projects.id,threads.projectId))
    .innerJoin(events,eq(events.threadId,threads.id))
    .where(and(where,args.afterThreadId === undefined ? undefined : sql`${threadPluginMetadata.threadId} COLLATE BINARY > ${args.afterThreadId}`))
    .groupBy(sql`${threadPluginMetadata.threadId} COLLATE BINARY`).orderBy(sql`${threadPluginMetadata.threadId} COLLATE BINARY`).limit(args.limit).all();
  return {total, rows};
}
