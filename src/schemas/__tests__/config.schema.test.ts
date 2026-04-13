import { describe, it, expect } from "vitest";
import { ConfigSchema } from "../config.schema.js";

const existingConfig = {
  branding: {
    logo: "logo.jpeg",
    assetsDir: "./assets",
    colors: { primary: "#1B3A4B", secondary: "#3A7CA5" },
    fonts: { heading: "Arial", body: "Calibri" },
  },
  elevenlabs: {
    voiceId: "PGXUlrgi0Tgxv5ovt9ip",
    modelId: "eleven_multilingual_v2",
    stability: 0.75,
    similarityBoost: 0.6,
    style: 0.22,
    speed: 0.95,
    useSpeakerBoost: true,
  },
  script: {
    speakerIdentity: "a friendly tutor",
    targetAudience: "GCSE students",
    systemPrompt: "Teach well",
    contextFiles: [],
    phoneticsOverrides: [],
    durationMinutes: 8,
  },
};

describe("ConfigSchema", () => {
  describe("backwards compatibility", () => {
    it("parses existing config without pipeline section", () => {
      const result = ConfigSchema.parse(existingConfig);
      expect(result.pipeline).toEqual({
        useIterativeContent: false,
        enableCritic: false,
        enableDesignValidation: false,
        useTemplateEngine: false,
        enableImageQueryGeneration: false,
      });
    });

    it("parses existing config without templateManifest in branding", () => {
      const result = ConfigSchema.parse(existingConfig);
      expect(result.branding.templateManifest).toBeUndefined();
    });

    it("applies default values for colors and fonts", () => {
      const result = ConfigSchema.parse(existingConfig);
      expect(result.branding.colors.background).toBe("#FFFFFF");
      expect(result.branding.colors.text).toBe("#1A1A1A");
      expect(result.branding.fonts.heading).toBe("Arial");
      expect(result.branding.fonts.body).toBe("Calibri");
    });
  });

  describe("pipeline section", () => {
    it("parses config with all pipeline flags set", () => {
      const result = ConfigSchema.parse({
        ...existingConfig,
        pipeline: {
          useIterativeContent: true,
          enableCritic: true,
          enableDesignValidation: true,
          useTemplateEngine: true,
        },
      });
      expect(result.pipeline.useIterativeContent).toBe(true);
      expect(result.pipeline.enableCritic).toBe(true);
      expect(result.pipeline.enableDesignValidation).toBe(true);
      expect(result.pipeline.useTemplateEngine).toBe(true);
    });

    it("uses defaults for missing pipeline flags", () => {
      const result = ConfigSchema.parse({
        ...existingConfig,
        pipeline: {
          useIterativeContent: true,
        },
      });
      expect(result.pipeline.useIterativeContent).toBe(true);
      expect(result.pipeline.enableCritic).toBe(false);
      expect(result.pipeline.enableDesignValidation).toBe(false);
      expect(result.pipeline.useTemplateEngine).toBe(false);
    });

    it("parses config with pipeline.enableImageQueryGeneration: true", () => {
      const result = ConfigSchema.parse({
        ...existingConfig,
        pipeline: {
          enableImageQueryGeneration: true,
        },
      });
      expect(result.pipeline.enableImageQueryGeneration).toBe(true);
    });

    it("defaults pipeline.enableImageQueryGeneration to false when omitted", () => {
      const result = ConfigSchema.parse(existingConfig);
      expect(result.pipeline.enableImageQueryGeneration).toBe(false);
    });
  });

  describe("branding templateManifest", () => {
    it("parses config with templateManifest in branding", () => {
      const result = ConfigSchema.parse({
        ...existingConfig,
        branding: {
          ...existingConfig.branding,
          templateManifest: "./assets/template-manifest.json",
        },
      });
      expect(result.branding.templateManifest).toBe(
        "./assets/template-manifest.json"
      );
    });

    it("parses config without templateManifest in branding", () => {
      const result = ConfigSchema.parse(existingConfig);
      expect(result.branding.templateManifest).toBeUndefined();
    });
  });

  describe("script slideStructureNotes", () => {
    it("parses config with script.slideStructureNotes set", () => {
      const result = ConfigSchema.parse({
        ...existingConfig,
        script: {
          ...existingConfig.script,
          slideStructureNotes: "./notes/slide-structure.md",
        },
      });
      expect(result.script.slideStructureNotes).toBe(
        "./notes/slide-structure.md"
      );
    });

    it("parses config without script.slideStructureNotes (optional)", () => {
      const result = ConfigSchema.parse(existingConfig);
      expect(result.script.slideStructureNotes).toBeUndefined();
    });

    it("rejects non-string script.slideStructureNotes", () => {
      const result = ConfigSchema.safeParse({
        ...existingConfig,
        script: {
          ...existingConfig.script,
          slideStructureNotes: 123,
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("validation", () => {
    it("rejects missing branding section", () => {
      const { branding: _, ...withoutBranding } = existingConfig;
      const result = ConfigSchema.safeParse(withoutBranding);
      expect(result.success).toBe(false);
    });

    it("rejects missing elevenlabs section", () => {
      const { elevenlabs: _, ...withoutElevenlabs } = existingConfig;
      const result = ConfigSchema.safeParse(withoutElevenlabs);
      expect(result.success).toBe(false);
    });

    it("rejects missing script section", () => {
      const { script: _, ...withoutScript } = existingConfig;
      const result = ConfigSchema.safeParse(withoutScript);
      expect(result.success).toBe(false);
    });

    it("rejects elevenlabs stability outside 0-1 range", () => {
      const result = ConfigSchema.safeParse({
        ...existingConfig,
        elevenlabs: {
          ...existingConfig.elevenlabs,
          stability: 1.5,
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects script durationMinutes outside 1-60 range", () => {
      const result = ConfigSchema.safeParse({
        ...existingConfig,
        script: {
          ...existingConfig.script,
          durationMinutes: 0,
        },
      });
      expect(result.success).toBe(false);
    });
  });
});
