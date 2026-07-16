import { z } from "zod";

export const accountNameSchema = z
  .string()
  .trim()
  .min(2, "Name must contain at least 2 characters.")
  .max(255, "Name must contain no more than 255 characters.");
