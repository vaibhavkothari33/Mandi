type Shape = 'packet' | 'tin' | 'jar' | 'tumbler' | 'press'

interface Palette {
  /** Background wash behind the product. */
  wash: string
  body: string
  bodyDark: string
  accent: string
}

/**
 * Product imagery, drawn rather than fetched.
 *
 * Photographs would mean either bundling files or hotlinking a stock CDN, and
 * a catalogue that stops rendering when someone else's host goes away is worse
 * than one drawn in a few hundred bytes of markup.
 */
const ART: Record<string, { shape: Shape; palette: Palette }> = {
  sku_chai_250: {
    shape: 'packet',
    palette: { wash: '#fdf2e3', body: '#b45309', bodyDark: '#92400e', accent: '#fcd34d' },
  },
  sku_coffee_500: {
    shape: 'packet',
    palette: { wash: '#f3ece5', body: '#5b3a29', bodyDark: '#432818', accent: '#d6a77a' },
  },
  sku_biscuit_pack: {
    shape: 'tin',
    palette: { wash: '#fdf6e3', body: '#dc9d3f', bodyDark: '#b87a26', accent: '#fff3d6' },
  },
  sku_namkeen_mix: {
    shape: 'packet',
    palette: { wash: '#fdeee8', body: '#c2410c', bodyDark: '#9a3412', accent: '#fdba74' },
  },
  sku_honey_500: {
    shape: 'jar',
    palette: { wash: '#fdf5da', body: '#e0a53a', bodyDark: '#b9822a', accent: '#7c4a11' },
  },
  sku_ghee_500: {
    shape: 'jar',
    palette: { wash: '#fdf8e6', body: '#f0cf72', bodyDark: '#cfae4f', accent: '#8a6a1f' },
  },
  sku_mug_steel: {
    shape: 'tumbler',
    palette: { wash: '#eef1f4', body: '#c3ccd6', bodyDark: '#94a3b3', accent: '#e8edf2' },
  },
  sku_press_french: {
    shape: 'press',
    palette: { wash: '#eef0f3', body: '#cfd7de', bodyDark: '#8d99a6', accent: '#5b4636' },
  },
}

const FALLBACK: Record<string, Shape> = {
  grocery: 'packet',
  snacks: 'tin',
  kitchen: 'tumbler',
}

const DEFAULT_PALETTE: Palette = {
  wash: '#f2efec',
  body: '#b9ada2',
  bodyDark: '#8d8177',
  accent: '#e6ded7',
}

function Body({ shape, palette }: { shape: Shape; palette: Palette }) {
  const { body, bodyDark, accent } = palette

  if (shape === 'packet') {
    return (
      <g>
        <path d="M40 30 h40 l-3 6 h-34 z" fill={bodyDark} />
        <path d="M37 36 h46 a4 4 0 0 1 4 4 v50 a4 4 0 0 1 -4 4 h-46 a4 4 0 0 1 -4 -4 v-50 a4 4 0 0 1 4 -4 z" fill={body} />
        <rect x="41" y="54" width="38" height="16" rx="2" fill={accent} opacity="0.85" />
        <rect x="41" y="76" width="22" height="4" rx="2" fill={accent} opacity="0.45" />
        <path d="M37 36 h10 v58 h-10 a4 4 0 0 1 -4 -4 v-50 a4 4 0 0 1 4 -4 z" fill="#ffffff" opacity="0.12" />
      </g>
    )
  }

  if (shape === 'tin') {
    return (
      <g>
        <rect x="32" y="44" width="56" height="46" rx="4" fill={body} />
        <ellipse cx="60" cy="44" rx="28" ry="8" fill={bodyDark} />
        <ellipse cx="60" cy="42" rx="24" ry="6" fill={accent} opacity="0.8" />
        <rect x="32" y="60" width="56" height="14" fill={accent} opacity="0.55" />
        <ellipse cx="60" cy="90" rx="28" ry="7" fill={bodyDark} opacity="0.6" />
        <rect x="32" y="44" width="10" height="46" fill="#ffffff" opacity="0.12" />
      </g>
    )
  }

  if (shape === 'jar') {
    return (
      <g>
        <rect x="44" y="26" width="32" height="10" rx="3" fill={accent} />
        <path d="M46 36 h28 a6 6 0 0 1 6 6 v42 a8 8 0 0 1 -8 8 h-24 a8 8 0 0 1 -8 -8 v-42 a6 6 0 0 1 6 -6 z" fill={body} />
        <rect x="44" y="56" width="32" height="18" rx="2" fill="#fffdf5" opacity="0.9" />
        <rect x="48" y="62" width="18" height="3" rx="1.5" fill={accent} opacity="0.7" />
        <rect x="48" y="68" width="12" height="3" rx="1.5" fill={accent} opacity="0.45" />
        <path d="M46 36 h8 v56 h-6 a8 8 0 0 1 -8 -8 v-42 a6 6 0 0 1 6 -6 z" fill="#ffffff" opacity="0.18" />
      </g>
    )
  }

  if (shape === 'tumbler') {
    return (
      <g>
        <path d="M42 36 h36 l-5 54 a4 4 0 0 1 -4 4 h-18 a4 4 0 0 1 -4 -4 z" fill={body} />
        <ellipse cx="60" cy="36" rx="18" ry="5" fill={accent} />
        <ellipse cx="60" cy="36" rx="13" ry="3.4" fill={bodyDark} opacity="0.55" />
        <path d="M46 40 h5 l-4 50 h-4 z" fill="#ffffff" opacity="0.45" />
        <path d="M70 40 h4 l-4 50 h-3 z" fill={bodyDark} opacity="0.35" />
      </g>
    )
  }

  return (
    <g>
      <rect x="40" y="42" width="40" height="50" rx="5" fill={body} />
      <rect x="40" y="42" width="10" height="50" rx="5" fill="#ffffff" opacity="0.3" />
      <rect x="36" y="34" width="48" height="9" rx="4" fill={bodyDark} />
      <rect x="57" y="18" width="6" height="18" rx="3" fill={bodyDark} />
      <rect x="50" y="14" width="20" height="6" rx="3" fill={accent} />
      <rect x="44" y="62" width="32" height="22" rx="3" fill={accent} opacity="0.35" />
      <path d="M80 52 q12 10 0 22" stroke={bodyDark} strokeWidth="4" fill="none" strokeLinecap="round" />
    </g>
  )
}

export function ProductArt({
  productId,
  category,
  className = '',
}: {
  productId: string
  category: string
  className?: string
}) {
  const art = ART[productId]
  const shape = art?.shape ?? FALLBACK[category] ?? 'packet'
  const palette = art?.palette ?? DEFAULT_PALETTE

  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      role="presentation"
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width="120" height="120" fill={palette.wash} />
      <circle cx="60" cy="58" r="42" fill="#ffffff" opacity="0.55" />
      <ellipse cx="60" cy="99" rx="30" ry="5" fill="#000000" opacity="0.07" />
      <Body shape={shape} palette={palette} />
    </svg>
  )
}
