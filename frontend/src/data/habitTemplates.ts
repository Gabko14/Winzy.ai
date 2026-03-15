import type { FrequencyType } from "../api/habits";

export type HabitTemplate = {
  id: string;
  name: string;
  icon: string;
  color: string;
  frequency: FrequencyType;
  description: string;
};

export type TemplateCategory = {
  id: string;
  label: string;
  templates: HabitTemplate[];
};

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  {
    id: "health",
    label: "Health",
    templates: [
      {
        id: "meditation",
        name: "Meditation",
        icon: "\uD83E\uDDD8",
        color: "#7C3AED",
        frequency: "daily",
        description: "Start with just 5 minutes",
      },
      {
        id: "exercise",
        name: "Exercise",
        icon: "\uD83C\uDFCB\uFE0F",
        color: "#EF4444",
        frequency: "daily",
        description: "Move your body, clear your mind",
      },
      {
        id: "drink-water",
        name: "Drink water",
        icon: "\uD83D\uDCA7",
        color: "#3B82F6",
        frequency: "daily",
        description: "8 glasses keeps you sharp",
      },
      {
        id: "sleep-8-hours",
        name: "Sleep 8 hours",
        icon: "\uD83D\uDCA4",
        color: "#6366F1",
        frequency: "daily",
        description: "Rest is the foundation",
      },
    ],
  },
  {
    id: "productivity",
    label: "Productivity",
    templates: [
      {
        id: "read-30-min",
        name: "Read 30 min",
        icon: "\uD83D\uDCD6",
        color: "#F59E0B",
        frequency: "daily",
        description: "A chapter a day adds up fast",
      },
      {
        id: "journal",
        name: "Journal",
        icon: "\u270D\uFE0F",
        color: "#F97316",
        frequency: "daily",
        description: "Capture your thoughts",
      },
      {
        id: "deep-work",
        name: "Deep work session",
        icon: "\uD83D\uDCBB",
        color: "#8B5CF6",
        frequency: "weekly",
        description: "90 minutes of focused flow",
      },
    ],
  },
  {
    id: "wellness",
    label: "Wellness",
    templates: [
      {
        id: "stretch",
        name: "Stretch",
        icon: "\uD83E\uDD38",
        color: "#14B8A6",
        frequency: "daily",
        description: "Loosen up, feel great",
      },
      {
        id: "no-social-media",
        name: "No social media before noon",
        icon: "\uD83D\uDCF5",
        color: "#EC4899",
        frequency: "daily",
        description: "Own your morning",
      },
      {
        id: "gratitude",
        name: "Gratitude",
        icon: "\uD83D\uDE4F",
        color: "#22C55E",
        frequency: "daily",
        description: "Three things you're thankful for",
      },
    ],
  },
  {
    id: "social",
    label: "Social",
    templates: [
      {
        id: "call-a-friend",
        name: "Call a friend",
        icon: "\uD83D\uDCDE",
        color: "#06B6D4",
        frequency: "weekly",
        description: "Stay connected with people you care about",
      },
      {
        id: "random-kindness",
        name: "Random act of kindness",
        icon: "\uD83D\uDC9B",
        color: "#EAB308",
        frequency: "weekly",
        description: "Small gestures make big differences",
      },
    ],
  },
];

export function getAllTemplates(): HabitTemplate[] {
  return TEMPLATE_CATEGORIES.flatMap((cat) => cat.templates);
}

export function getTemplateById(id: string): HabitTemplate | undefined {
  return getAllTemplates().find((t) => t.id === id);
}
