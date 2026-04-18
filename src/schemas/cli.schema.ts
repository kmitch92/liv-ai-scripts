import { z } from "zod";

export const CliArgsSchema = z.object({
  topic: z.string().optional(),
  config: z.string().min(1, "Config file path is required"),
  output: z.string().optional(),
});
