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
    text: '#203b38',
    tint: '#1e6b5a',

    // Core surfaces
    background: '#f5f2eb',
    foreground: '#203b38',

    // Cards / elevated surfaces
    card: '#fffefa',
    cardForeground: '#203b38',

    // Primary action color (buttons, links, active states)
    primary: '#1e6b5a',
    primaryForeground: '#fffefa',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#e9e6dc',
    secondaryForeground: '#203b38',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#ece9e1',
    mutedForeground: '#71817a',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#e3a267',
    accentForeground: '#203b38',

    // Destructive actions (delete, error states)
    destructive: '#b15c4e',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#e3e4d9',
    input: '#d9dfd5',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
