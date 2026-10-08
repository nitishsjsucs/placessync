import { Hono } from "hono";
import { ResourceFiltersSchema, type ResourcesResponse } from "../../shared/api.ts";
import { filterResources } from "../../shared/resource-filter.ts";
import type { AppEnv } from "../app-env.ts";
import { queryParams } from "../http.ts";
import { amenityLabels, listResources } from "../repo/catalog.ts";

export const resourceRoutes = new Hono<AppEnv>().get(
  "/api/sites/:siteId/resources",
  queryParams(ResourceFiltersSchema),
  async (c) => {
    const filters = c.req.valid("query");
    const [resources, labels] = await Promise.all([listResources(c.env.DB, c.get("config").siteId), amenityLabels(c.env.DB)]);
    const body: ResourcesResponse = { resources: filterResources(resources.filter((r) => r.active), filters, labels) };
    return c.json(body);
  },
);
