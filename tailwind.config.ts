import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

/*
 * Tailwind theme extension — all values reference CSS variables defined
 * in src/renderer/src/styles/tokens.css. No hex literals live here.
 *
 * Switching data-theme="dark" on <html> automatically cascades to every
 * utility (bg-accent, text-primary, etc.) without a Tailwind recompile.
 */
const config: Config = {
  plugins: [animate],
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{vue,ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--app-bg)',
        foreground: 'var(--text-primary)',
        card: { DEFAULT: 'var(--card-bg)', foreground: 'var(--text-primary)' },
        popover: { DEFAULT: 'var(--card-bg)', foreground: 'var(--text-primary)' },
        muted: { DEFAULT: 'var(--bg-sunken)', foreground: 'var(--text-secondary)' },
        secondary: { DEFAULT: 'var(--card-bg-hover)', foreground: 'var(--text-primary)' },
        destructive: { DEFAULT: 'var(--danger)', foreground: 'var(--danger-fg)' },
        'primary-foreground': 'var(--text-on-accent)',
        'accent-foreground': 'var(--text-primary)',
        'ui-accent': 'var(--selected-bg)',
        input: 'var(--border)',
        ring: 'var(--accent)',
        primary: 'var(--primary)',
        'primary-hover': 'var(--primary-hover)',
        'primary-active': 'var(--primary-active)',
        'primary-soft': 'var(--primary-soft)',
        'primary-border': 'var(--primary-border)',
        accent: 'var(--accent)',
        'app-bg': 'var(--app-bg)',
        /* 凹陷层：表头 / 输入框 / 代码块 */
        sunken: 'var(--bg-sunken)',
        'card-bg': 'var(--card-bg)',
        'card-bg-hover': 'var(--card-bg-hover)',
        'card-bg-pressed': 'var(--card-bg-pressed)',
        'selected-bg': 'var(--selected-bg)',
        'selected-border': 'var(--selected-border)',
        /* Material layer — one token per role (see styles/tokens.css).
         * `media-bg` is the neutral thumbnail/track surface: it must never be
         * an accent tint, otherwise every card reads as a coloured box. */
        'media-bg': 'var(--media-bg)',
        'hover-surface': 'var(--hover-surface)',
        'surface-pressed': 'var(--surface-pressed)',
        'select-surface': 'var(--select-surface)',
        hairline: 'var(--hairline)',
        done: 'var(--done)',
        'done-fg': 'var(--done-fg)',
        'done-soft': 'var(--done-soft)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        'text-on-accent': 'var(--text-on-accent)',
        danger: 'var(--danger)',
        'danger-fg': 'var(--danger-fg)',
        'danger-soft': 'var(--danger-soft)',
        success: 'var(--success)',
        'success-fg': 'var(--success-fg)',
        'success-soft': 'var(--success-soft)',
        warning: 'var(--warning)',
        'warning-fg': 'var(--warning-fg)',
        'warning-soft': 'var(--warning-soft)',
        info: 'var(--info)',
        'info-fg': 'var(--info-fg)',
        'info-soft': 'var(--info-soft)',
        'warning-on-soft': 'var(--warning-on-soft)',
        'info-on-soft': 'var(--info-on-soft)'
      },
      borderRadius: {
        badge: 'var(--radius-badge)'
      }
    }
  },

}

export default config
