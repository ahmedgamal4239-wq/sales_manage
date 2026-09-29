import { pgTable, serial, text, integer, boolean, numeric, timestamp, date, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("ops_users", {
  id: serial("id").primaryKey(),
  employeeId: text("employee_id").notNull().unique(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en"),
  role: text("role").notNull().default("PENDING"),
  permissions: jsonb("permissions").$type<string[] | null>(),
  passwordHash: text("password_hash"),
  active: boolean("active").notNull().default(false),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  areaId: integer("area_id"),
  branchId: integer("branch_id"),
  sessionVersion: integer("session_version").notNull().default(0),
});

export const sessions = pgTable("ops_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  version: integer("version").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const customers = pgTable("ops_customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  address: text("address"),
  phone: text("phone"),
  ownerId: integer("owner_id").references(() => users.id),
  areaId: integer("area_id"),
});

export const customerPayments = pgTable("ops_customer_payments", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  recordedBy: integer("recorded_by").notNull().references(() => users.id),
  method: text("method").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentDate: date("payment_date", { mode: "string" }).notNull(),
  photoObjectPath: text("photo_object_path").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const branches = pgTable("ops_branches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  chain: text("chain"),
  areaId: integer("area_id"),
  agentId: integer("agent_id").references(() => users.id),
  latitude: numeric("latitude", { mode: "number" }),
  longitude: numeric("longitude", { mode: "number" }),
  radiusMeters: integer("radius_meters").notNull().default(150),
  timezone: text("timezone").notNull().default("UTC"),
});

export const products = pgTable("ops_products", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en"),
  price: numeric("price", { precision: 14, scale: 2 }).notNull(),
  priceReview: boolean("price_review").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

export const sales = pgTable("ops_sales", {
  id: serial("id").primaryKey(),
  sellerId: integer("seller_id").notNull().references(() => users.id),
  branchId: integer("branch_id").notNull().references(() => branches.id),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("DRAFT"),
  gross: numeric("gross", { precision: 14, scale: 2 }).notNull().default("0"),
  returns: numeric("returns", { precision: 14, scale: 2 }).notNull().default("0"),
  net: numeric("net", { precision: 14, scale: 2 }).notNull().default("0"),
  lines: jsonb("lines").notNull().$type<Array<{productId:number; quantity:number; amount:string; returns:string}>>(),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("ops_sales_seller_branch_date").on(t.sellerId,t.branchId,t.businessDate)]);

export const attendance = pgTable("ops_attendance", {
  id: serial("id").primaryKey(),
  sellerId: integer("seller_id").notNull().references(() => users.id),
  branchId: integer("branch_id").notNull().references(() => branches.id),
  type: text("type").notNull(),
  status: text("status").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  latitude: numeric("latitude", { mode: "number" }).notNull(),
  longitude: numeric("longitude", { mode: "number" }).notNull(),
  accuracy: numeric("accuracy", { mode: "number" }).notNull(),
  distanceMeters: numeric("distance_meters", { mode: "number" }),
});

export const importBatches = pgTable("ops_import_batches", {
  token: text("token").primaryKey(),
  kind: text("kind").notNull(),
  sheet: text("sheet").notNull(),
  filename: text("filename").notNull(),
  actorId: integer("actor_id").notNull().references(() => users.id),
  rows: jsonb("rows").notNull().$type<Array<{code:string;name:string;nameEn?:string;price?:string;change:string}>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});

export const audit = pgTable("ops_audit", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => users.id),
  action: text("action").notNull(),
  target: text("target").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});