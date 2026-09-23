import "server-only";

import { cache } from "react";

import { parseOrderMode, type OrderMode } from "@/domain/order-mode";
import { getDb } from "@/server/db/client";

export const ORDER_MODE_SETTING_KEY = "commerce.order_mode";

export const getOrderMode = cache(async (): Promise<OrderMode> => {
  try {
    const setting = await getDb().siteSetting.findUnique({
      where: { key: ORDER_MODE_SETTING_KEY },
      select: { value: true },
    });
    return parseOrderMode(setting?.value);
  } catch (error) {
    console.error("Order mode setting is unavailable.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return parseOrderMode(undefined);
  }
});
