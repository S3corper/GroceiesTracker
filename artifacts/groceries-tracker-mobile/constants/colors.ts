/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#292725',
    tint: '#c83d38',

    // Core surfaces
    background: '#f4f2ef',
    foreground: '#292725',

    // Cards / elevated surfaces
    card: '#ffffff',
    cardForeground: '#292725',

    // Primary action color (buttons, links, active states)
    primary: '#c83d38',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#f6f4f1',
    secondaryForeground: '#3a3733',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#ebe8e4',
    mutedForeground: '#817c76',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#f5e5d7',
    accentForeground: '#5a3e2e',

    // Destructive actions (delete, error states)
    destructive: '#c83d38',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#e6e1db',
    input: '#ddd6ce',
  },

  dark: {
    text: '#f4f0eb',
    tint: '#ea6a63',
    background: '#242321',
    foreground: '#f4f0eb',
    card: '#302f2c',
    cardForeground: '#f4f0eb',
    primary: '#ea6a63',
    primaryForeground: '#ffffff',
    secondary: '#393733',
    secondaryForeground: '#f4f0eb',
    muted: '#3c3a36',
    mutedForeground: '#b1aaa2',
    accent: '#5a4436',
    accentForeground: '#f7d8bd',
    destructive: '#ea6a63',
    destructiveForeground: '#ffffff',
    border: '#4a4640',
    input: '#514c45',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 10,
};

export default colors;
