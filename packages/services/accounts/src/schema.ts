import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { CURRENCIES } from "@sudsnik/contracts/canon";

export const operators = sqliteTable("operators", {
  operatorId: text("operator_id").primaryKey(),
  name: text("name").notNull(),
  pricingTier: text("pricing_tier", { enum: ["standard", "priority"] }).notNull(),
  region: text("region", { enum: ["us", "eu", "apac"] }).notNull(),
  currency: text("currency", { enum: CURRENCIES }).notNull(),
});

export const habitats = sqliteTable("habitats", {
  habitatId: text("habitat_id").primaryKey(),
  operatorId: text("operator_id")
    .notNull()
    .references(() => operators.operatorId),
  index: integer("idx").notNull(),
  name: text("name").notNull(),
});

export const crews = sqliteTable("crews", {
  crewId: text("crew_id").primaryKey(),
  habitatId: text("habitat_id")
    .notNull()
    .references(() => habitats.habitatId),
  name: text("name").notNull(),
  preferences: text("preferences", { mode: "json" }).$type<Record<string, string>>().notNull(),
});
