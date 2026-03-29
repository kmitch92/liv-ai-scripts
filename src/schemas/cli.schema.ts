import { z } from "zod";

export const CliArgsSchema = z.object({
  topic: z.string().min(1, "Topic is required"),
  config: z.string().min(1, "Config file path is required"),
  output: z.string().optional(),
});
