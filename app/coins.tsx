interface Coin {
  /** Percentage offsets so the field reflows with the hero. */
  left: string
  top: string
  size: number
  /** Farther coins are smaller, softer and slower, which reads as depth. */
  depth: 'far' | 'mid' | 'near'
  driftFrom: string
  driftTo: string
  tiltFrom: string
  tiltTo: string
  duration: string
  delay: string
}

const COINS: Coin[] = [
  { left: '6%', top: '18%', size: 54, depth: 'mid', driftFrom: '0px', driftTo: '-22px', tiltFrom: '-12deg', tiltTo: '4deg', duration: '7s', delay: '0s' },
  { left: '13%', top: '58%', size: 38, depth: 'far', driftFrom: '-8px', driftTo: '14px', tiltFrom: '18deg', tiltTo: '-6deg', duration: '9s', delay: '-2s' },
  { left: '2%', top: '72%', size: 68, depth: 'near', driftFrom: '6px', driftTo: '-16px', tiltFrom: '8deg', tiltTo: '-14deg', duration: '6.5s', delay: '-4s' },
  { left: '88%', top: '14%', size: 46, depth: 'far', driftFrom: '4px', driftTo: '-18px', tiltFrom: '-20deg', tiltTo: '2deg', duration: '8.5s', delay: '-1s' },
  { left: '80%', top: '46%', size: 72, depth: 'near', driftFrom: '-10px', driftTo: '18px', tiltFrom: '10deg', tiltTo: '-10deg', duration: '7.5s', delay: '-3s' },
  { left: '93%', top: '68%', size: 40, depth: 'mid', driftFrom: '0px', driftTo: '-20px', tiltFrom: '-6deg', tiltTo: '16deg', duration: '10s', delay: '-5s' },
  { left: '70%', top: '8%', size: 30, depth: 'far', driftFrom: '-6px', driftTo: '12px', tiltFrom: '14deg', tiltTo: '-8deg', duration: '11s', delay: '-6s' },
  { left: '24%', top: '6%', size: 34, depth: 'far', driftFrom: '2px', driftTo: '-14px', tiltFrom: '-16deg', tiltTo: '6deg', duration: '9.5s', delay: '-7s' },
]

const DEPTH = {
  far: { opacity: 0.28, blur: '1.4px' },
  mid: { opacity: 0.42, blur: '0.5px' },
  near: { opacity: 0.55, blur: '0px' },
} as const

/**
 * Rupee coins drifting behind the hero.
 *
 * Rendered as inline SVG rather than images so nothing is fetched at runtime,
 * and marked decorative so it is skipped by assistive technology. Animation is
 * pure CSS, which keeps the landing page free of any client bundle.
 */
export function Coins() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {COINS.map((coin, index) => {
        const depth = DEPTH[coin.depth]

        return (
          <span
            key={index}
            className="coin absolute"
            style={
              {
                left: coin.left,
                top: coin.top,
                opacity: depth.opacity,
                filter: `blur(${depth.blur})`,
                '--drift-from': coin.driftFrom,
                '--drift-to': coin.driftTo,
                '--tilt-from': coin.tiltFrom,
                '--tilt-to': coin.tiltTo,
                '--drift-duration': coin.duration,
                '--drift-delay': coin.delay,
              } as React.CSSProperties
            }
          >
            <svg
              width={coin.size}
              height={coin.size}
              viewBox="0 0 64 64"
              fill="none"
              /* Squashed slightly so each coin reads as a disc seen off-axis. */
              style={{ transform: 'rotateX(24deg)' }}
            >
              <defs>
                <radialGradient id={`face-${index}`} cx="34%" cy="26%" r="78%">
                  <stop offset="0%" stopColor="#fde8c0" />
                  <stop offset="52%" stopColor="#e8b96a" />
                  <stop offset="100%" stopColor="#b4832f" />
                </radialGradient>
                <linearGradient id={`edge-${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#8a6320" stopOpacity="0.35" />
                </linearGradient>
              </defs>

              <circle cx="32" cy="32" r="30" fill={`url(#face-${index})`} />
              <circle cx="32" cy="32" r="30" fill="none" stroke={`url(#edge-${index})`} strokeWidth="2" />
              <circle cx="32" cy="32" r="24" fill="none" stroke="#8a6320" strokeOpacity="0.28" strokeWidth="1" />

              <text
                x="32"
                y="42"
                textAnchor="middle"
                fontSize="26"
                fontWeight="600"
                fill="#7a5518"
                fillOpacity="0.75"
                fontFamily="system-ui, sans-serif"
              >
                ₹
              </text>
            </svg>
          </span>
        )
      })}
    </div>
  )
}
