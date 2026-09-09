import { int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  clientId: varchar("clientId", { length: 64 }),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  plan: mysqlEnum("plan", ["starter", "growth", "scale"]).default("starter").notNull(),
  status: mysqlEnum("status", ["trial", "active", "past_due", "canceled"]).default("trial").notNull(),
  logoUrl: text("logoUrl"),
  primaryColor: varchar("primaryColor", { length: 32 }).default("#c99518").notNull(),
  maxUnits: int("maxUnits").default(1).notNull(),
  maxUsers: int("maxUsers").default(12).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  reconciliationStatus: mysqlEnum("reconciliationStatus", ["matched", "review"]).default("review").notNull(),
  reconciliationNote: text("reconciliationNote"),
});

export const memberships = mysqlTable("memberships", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["owner", "admin", "manager", "professional", "viewer"]).default("viewer").notNull(),
  status: mysqlEnum("status", ["active", "invited", "suspended"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ membershipIdx: uniqueIndex("memberships_org_user_idx").on(table.organizationId, table.userId) }));

export const organizationUnits = mysqlTable("organizationUnits", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull(),
  city: varchar("city", { length: 120 }),
  status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ unitSlugIdx: uniqueIndex("organization_units_org_slug_idx").on(table.organizationId, table.slug) }));

export const modulePolicies = mysqlTable("modulePolicies", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  unitId: int("unitId").notNull(),
  role: mysqlEnum("role", ["owner", "admin", "manager", "professional", "viewer"]).notNull(),
  module: varchar("module", { length: 64 }).notNull(),
  canView: int("canView").default(1).notNull(),
  canManage: int("canManage").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ policyIdx: uniqueIndex("module_policies_scope_idx").on(table.organizationId, table.unitId, table.role, table.module) }));

export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  plan: mysqlEnum("plan", ["starter", "growth", "scale"]).notNull(),
  status: mysqlEnum("status", ["trialing", "active", "past_due", "canceled"]).default("trialing").notNull(),
  billingCycle: mysqlEnum("billingCycle", ["monthly", "yearly"]).default("monthly").notNull(),
  amountCents: int("amountCents").default(0).notNull(),
  provider: varchar("provider", { length: 32 }).default("sandbox").notNull(),
  externalRef: varchar("externalRef", { length: 180 }),
  renewsAt: timestamp("renewsAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const invitations = mysqlTable("invitations", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  invitedByUserId: int("invitedByUserId").notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  role: mysqlEnum("role", ["admin", "manager", "professional", "viewer"]).default("viewer").notNull(),
  status: mysqlEnum("status", ["pending", "accepted", "expired", "revoked"]).default("pending").notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const onboardingProgress = mysqlTable("onboardingProgress", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull().unique(),
  currentStep: int("currentStep").default(1).notNull(),
  status: mysqlEnum("status", ["not_started", "in_progress", "completed"]).default("not_started").notNull(),
  city: varchar("city", { length: 120 }),
  defaultUnitName: varchar("defaultUnitName", { length: 160 }),
  inviteEmail: varchar("inviteEmail", { length: 320 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  userId: int("userId").notNull(),
  unitId: int("unitId"),
  action: varchar("action", { length: 64 }).notNull(),
  entity: varchar("entity", { length: 64 }).notNull(),
  entityId: int("entityId"),
  beforeJson: text("beforeJson"),
  afterJson: text("afterJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type OrganizationUnit = typeof organizationUnits.$inferSelect;
export type ModulePolicy = typeof modulePolicies.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type OnboardingProgress = typeof onboardingProgress.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
