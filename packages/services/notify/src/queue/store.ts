import type { Notification } from "@sudsnik/contracts/services/notify";
import type { Db } from "@sudsnik/infra-db";

export type NotificationState = Notification["state"];

export interface NotificationRow {
  notification_id: string;
  tenant_id: string;
  habitat_id: string;
  order_id: string | null;
  channel: string;
  template: string;
  params: string;
  title: string;
  body: string;
  correlation_id: string;
  state: NotificationState;
  created_at: number;
  delivered_at: number | null;
  attempts: number;
  not_before: number;
}

export interface NewNotification {
  notificationId: string;
  tenantId: string;
  habitatId: string;
  orderId?: string;
  channel: string;
  template: string;
  params: Record<string, string>;
  title: string;
  body: string;
  correlationId: string;
  createdAt: number;
  state: NotificationState;
}

export interface DeliveryAttempt {
  deliveryId: string;
  notificationId: string;
  tenantId: string;
  attempt: number;
  attemptedAt: number;
  outcome: "delivered" | "failed";
  relayDeliveryId?: string;
  error?: string;
}

export function toNotification(row: NotificationRow): Notification {
  return {
    notificationId: row.notification_id,
    tenantId: row.tenant_id,
    habitatId: row.habitat_id,
    ...(row.order_id === null ? {} : { orderId: row.order_id }),
    channel: row.channel as Notification["channel"],
    template: row.template,
    params: JSON.parse(row.params) as Record<string, string>,
    state: row.state,
    createdAt: row.created_at,
    ...(row.delivered_at === null ? {} : { deliveredAt: row.delivered_at }),
  };
}

/** The service's tables through raw SQL; every statement is priced by the db helpers. */
export function createStore(db: Db) {
  return {
    transaction: <T>(fn: () => T): T => db.transaction(fn),

    /** True when this envelope is new to the tenant; a repeat leaves the earlier row untouched. */
    markSeen(tenantId: string, envelopeId: string, notificationId: string | undefined, seenAt: number): boolean {
      const r = db.write("insert or ignore into dedupe (tenant_id, envelope_id, notification_id, seen_at) values (?, ?, ?, ?)", tenantId, envelopeId, notificationId ?? null, seenAt);
      return r.changes === 1;
    },

    rememberOrder(tenantId: string, orderId: string, habitatId: string): void {
      db.write("insert or ignore into orders (tenant_id, order_id, habitat_id) values (?, ?, ?)", tenantId, orderId, habitatId);
    },

    habitatOfOrder(tenantId: string, orderId: string): string | undefined {
      return db.readOne<{ habitat_id: string }>("select habitat_id from orders where tenant_id = ? and order_id = ?", tenantId, orderId)?.habitat_id;
    },

    insertNotification(n: NewNotification): void {
      db.write(
        "insert into notifications (notification_id, tenant_id, habitat_id, order_id, channel, template, params, title, body, correlation_id, state, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        n.notificationId,
        n.tenantId,
        n.habitatId,
        n.orderId ?? null,
        n.channel,
        n.template,
        JSON.stringify(n.params),
        n.title,
        n.body,
        n.correlationId,
        n.state,
        n.createdAt,
      );
    },

    notification(notificationId: string): NotificationRow | undefined {
      return db.readOne<NotificationRow>("select * from notifications where notification_id = ?", notificationId);
    },

    /** Every undelivered notification, oldest first; the delivery gate decides which are due. */
    undelivered(): NotificationRow[] {
      return db.read<NotificationRow>("select * from notifications where state in ('queued', 'digested') order by created_at, notification_id");
    },

    pending(tenantId: string, habitatId: string): NotificationRow[] {
      return db.read<NotificationRow>(
        "select * from notifications where tenant_id = ? and habitat_id = ? and state in ('queued', 'digested') order by created_at, notification_id",
        tenantId,
        habitatId,
      );
    },

    setState(notificationId: string, state: NotificationState, deliveredAt?: number): void {
      db.write("update notifications set state = ?, delivered_at = coalesce(?, delivered_at) where notification_id = ?", state, deliveredAt ?? null, notificationId);
    },

    recordAttempt(a: DeliveryAttempt, notBefore: number): void {
      db.write(
        "insert into deliveries (delivery_id, notification_id, tenant_id, attempt, attempted_at, outcome, relay_delivery_id, error) values (?, ?, ?, ?, ?, ?, ?, ?)",
        a.deliveryId,
        a.notificationId,
        a.tenantId,
        a.attempt,
        a.attemptedAt,
        a.outcome,
        a.relayDeliveryId ?? null,
        a.error ?? null,
      );
      db.write("update notifications set attempts = ?, not_before = ? where notification_id = ?", a.attempt, notBefore, a.notificationId);
    },

    attempts(notificationId: string): DeliveryAttempt[] {
      return db
        .read<{ delivery_id: string; notification_id: string; tenant_id: string; attempt: number; attempted_at: number; outcome: DeliveryAttempt["outcome"]; relay_delivery_id: string | null; error: string | null }>(
          "select * from deliveries where notification_id = ? order by attempt",
          notificationId,
        )
        .map((r) => ({
          deliveryId: r.delivery_id,
          notificationId: r.notification_id,
          tenantId: r.tenant_id,
          attempt: r.attempt,
          attemptedAt: r.attempted_at,
          outcome: r.outcome,
          ...(r.relay_delivery_id === null ? {} : { relayDeliveryId: r.relay_delivery_id }),
          ...(r.error === null ? {} : { error: r.error }),
        }));
    },

    // The sweep picks dead letters up again once an orbit and keeps trying until an operator clears them.
    deadLetter(notificationId: string, tenantId: string, attempts: number, reason: string, deadAt: number): void {
      db.write("insert or ignore into dead_letters (notification_id, tenant_id, attempts, reason, dead_at) values (?, ?, ?, ?, ?)", notificationId, tenantId, attempts, reason, deadAt);
    },

    deadLetters(tenantId?: string): Array<{ notification_id: string; tenant_id: string; attempts: number; reason: string; dead_at: number }> {
      return tenantId === undefined
        ? db.read("select * from dead_letters order by dead_at, notification_id")
        : db.read("select * from dead_letters where tenant_id = ? order by dead_at, notification_id", tenantId);
    },

    pendingCount(): number {
      return db.readOne<{ n: number }>("select count(*) as n from notifications where state in ('queued', 'digested')")?.n ?? 0;
    },
  };
}

export type Store = ReturnType<typeof createStore>;
